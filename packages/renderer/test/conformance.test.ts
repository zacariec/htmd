import { ContractDiagnosticCode, baseCatalog, createHost } from '@htmdjs/contracts';
import type { ComponentContract, HtmdHost, UrlPurpose } from '@htmdjs/contracts';
import { registerHtmdElements, setHtmdElementsLogSink } from '@htmdjs/elements';
import { Parser } from '@htmdjs/parser';
import type { HtmdNode } from '@htmdjs/parser';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { renderHtmdSource } from '../src/materialize.js';
import { RegionTreeRenderer } from '../src/region-tree-renderer.js';
import { RendererEvents } from '../src/renderer-events.js';
import type { RegionUpdatedDetail } from '../src/renderer-events.js';

/**
 * Shared conformance suite. Every contract in the base catalog is exercised
 * through its own examples, so a new component inherits these guarantees by
 * declaring a contract. Component-specific interaction lives with the
 * components; this suite owns the properties every component must satisfy.
 */

const contracts = baseCatalog.contracts();
const everyTag = baseCatalog.tags().join(',');
const permissiveHost: HtmdHost = createHost({
  components: baseCatalog,
  authorizeUrl: () => true,
  loadData: async () => ({ columns: ['week'], rows: [{ week: 'w49' }] }),
});

beforeAll(() => {
  registerHtmdElements();
  setHtmdElementsLogSink({ warn: () => {}, error: () => {} });
});

afterEach(() => {
  document.body.replaceChildren();
});

function staticRender(source: string, host: HtmdHost = permissiveHost) {
  const target = document.createElement('div');
  document.body.append(target);
  const result = renderHtmdSource(target, source, { host });
  return { target, result };
}

function streamed(host: HtmdHost = permissiveHost) {
  const root = document.createElement('div');
  document.body.append(root);
  const renderer = new RegionTreeRenderer(root, { host });
  let seq = 0;
  renderer.apply({ type: 'doc-open', seq: seq++, id: 'conformance', schemaVersion: '0.1' });
  const content = (): Element => {
    const region = renderer.regionElement('$.body');
    const element = region?.querySelector(':scope > [data-htmd-content]');
    if (element === null || element === undefined) {
      throw new Error('missing region content');
    }
    return element;
  };
  return {
    root,
    renderer,
    content,
    send: (chunk: string): boolean =>
      renderer.apply({ type: 'stream', seq: seq++, target: '$.body', chunk }),
    replace: (body: string): boolean =>
      renderer.apply({ type: 'region-replace', seq: seq++, id: '$.body', body }),
    regionDone: (): boolean => renderer.apply({ type: 'region-done', seq: seq++, id: '$.body' }),
    docDone: (): boolean => renderer.apply({ type: 'doc-done', seq: seq++, id: 'conformance' }),
  };
}

function count(root: ParentNode, tag: string): number {
  return root.querySelectorAll(tag).length;
}

/** Offset just after `<tag` of the first element with `tag` in `source`. */
function openTagNameEnd(source: string, tag: string): number {
  const find = (nodes: readonly HtmdNode[]): number | undefined => {
    for (const node of nodes) {
      if (node.type !== 'element') continue;
      if (node.tag === tag) return node.start + 1 + tag.length;
      const nested = find(node.children);
      if (nested !== undefined) return nested;
    }
    return undefined;
  };
  const offset = find(Parser.getInstance().parse(source).document.nodes);
  if (offset === undefined) throw new Error(`example has no <${tag}>`);
  return offset;
}

function withAttribute(source: string, tag: string, attribute: string): string {
  const at = openTagNameEnd(source, tag);
  return `${source.slice(0, at)} ${attribute}${source.slice(at)}`;
}

function withoutAttribute(source: string, tag: string, name: string): string {
  const at = openTagNameEnd(source, tag);
  const tagEnd = source.indexOf('>', at);
  const openTag = source.slice(at, tagEnd).replace(new RegExp(`\\s${name}="[^"]*"`), '');
  return source.slice(0, at) + openTag + source.slice(tagEnd);
}

/** Complete elements with `tag` in a streaming parse of `prefix`. */
/**
 * Occurrences of `tag` in a streaming parse of `prefix`: complete ones render;
 * incomplete ones hold a deferred placeholder unless an ancestor is itself deferred.
 */
function occurrences(prefix: string, tag: string): { complete: number; deferred: number } {
  const result = { complete: 0, deferred: 0 };
  const walk = (nodes: readonly HtmdNode[], insideDeferred: boolean): void => {
    for (const node of nodes) {
      if (node.type !== 'element') continue;
      if (node.tag === tag && !insideDeferred) {
        result[node.complete ? 'complete' : 'deferred'] += 1;
      }
      const deferred = !node.complete && baseCatalog.get(node.tag)?.partial === 'complete';
      walk(node.children, insideDeferred || deferred);
    }
  };
  walk(Parser.getInstance().parse(prefix, { streaming: true }).document.nodes, false);
  return result;
}

const EFFECT_FOR_PURPOSE: Record<UrlPurpose, string> = {
  data: 'load-data',
  image: 'load-image',
  link: 'navigate',
  download: 'download',
};

describe.each(contracts.map((contract): [string, ComponentContract] => [contract.tag, contract]))(
  '<%s> contract',
  (tag, contract) => {
    it('declares effects for every URL attribute and intent', () => {
      for (const attribute of Object.values(contract.attributes)) {
        if (attribute.url !== undefined) {
          expect(contract.effects).toContain(EFFECT_FOR_PURPOSE[attribute.url]);
        }
      }
      if (contract.events.length > 0) {
        expect(contract.effects).toContain('emit-intent');
      }
    });

    it.each(contract.examples)('renders its example without diagnostics: %s', (example) => {
      const { target, result } = staticRender(example);
      expect(result.diagnostics).toEqual([]);
      expect(count(target, tag)).toBeGreaterThan(0);
    });

    it.each(contract.examples)(
      'produces the same final DOM for every two-chunk split: %s',
      (example) => {
        const expected = staticRender(example).target.innerHTML;
        for (let split = 1; split < example.length; split += 1) {
          const stream = streamed();
          stream.send(example.slice(0, split));
          stream.send(example.slice(split));
          stream.docDone();
          expect(stream.content().innerHTML, `split at ${split}`).toBe(expected);
          stream.root.remove();
        }
      },
    );

    it.each(contract.examples)(
      'treats every prefix as incomplete, not invalid: no partial tags as text, no fallbacks, no diagnostics, no premature instances: %s',
      (example) => {
        const stream = streamed();
        let diagnostics: RegionUpdatedDetail['diagnostics'] = [];
        stream.renderer.addEventListener(RendererEvents.RegionUpdated, (event) => {
          diagnostics = (event as CustomEvent<RegionUpdatedDetail>).detail.diagnostics;
        });
        for (let end = 1; end <= example.length; end += 1) {
          stream.send(example.slice(end - 1, end));
          const content = stream.content();
          expect(content.textContent ?? '', `prefix ${end}`).not.toMatch(/<\/?[a-z]+-[a-z-]*/);
          expect(content.querySelector('[data-htmd-fallback]'), `prefix ${end}`).toBeNull();
          expect(diagnostics, `prefix ${end}`).toEqual([]);
          for (const candidate of contracts) {
            if (candidate.partial === 'complete') {
              const expected = occurrences(example.slice(0, end), candidate.tag);
              const at = `<${candidate.tag}> at prefix ${end}`;
              expect(count(content, candidate.tag), at).toBe(expected.complete);
              const placeholders = content.querySelectorAll(
                `[data-htmd-deferred="${candidate.tag}"][aria-busy="true"]`,
              );
              expect(placeholders.length, at).toBe(expected.deferred);
            }
          }
        }
      },
    );

    it('is not instantiated when the host catalog omits it, even though it is registered', () => {
      const example = contract.examples[0];
      const host = createHost({ components: baseCatalog.without(tag), authorizeUrl: () => true });
      const { target, result } = staticRender(example, host);
      expect(customElements.get(tag)).toBeDefined();
      expect(count(target, tag)).toBe(0);
      expect(result.diagnostics.map((d) => d.code)).toContain(
        ContractDiagnosticCode.UnknownComponent,
      );
      expect(target.querySelector(`[data-htmd-fallback="${tag}"]`)).not.toBeNull();
    });

    it('honors version pins: current renders, unsupported falls back', () => {
      const example = contract.examples[0];
      const expected = count(staticRender(example).target, tag);
      const current = staticRender(
        withAttribute(example, tag, `data-htmd-version="${contract.version}"`),
      );
      expect(count(current.target, tag)).toBe(expected);
      const future = staticRender(withAttribute(example, tag, 'data-htmd-version="999"'));
      expect(count(future.target, tag)).toBe(expected - 1);
      expect(future.result.diagnostics.map((d) => d.code)).toContain(
        ContractDiagnosticCode.UnsupportedVersion,
      );
    });

    it('ignores undeclared attributes instead of forwarding them', () => {
      const example = contract.examples[0];
      const expected = count(staticRender(example).target, tag);
      const { target, result } = staticRender(withAttribute(example, tag, 'data-injected="1"'));
      expect(count(target, tag)).toBe(expected);
      expect(target.querySelector(`${tag}[data-injected]`)).toBeNull();
      expect(result.diagnostics.map((d) => d.code)).toContain(
        ContractDiagnosticCode.UnknownAttribute,
      );
    });

    const required = Object.entries(contract.attributes)
      .filter(([, attribute]) => attribute.required === true)
      .map(([name]) => name);
    it.skipIf(required.length === 0).each(required)(
      'falls back when required attribute "%s" is missing',
      (name) => {
        const example = contract.examples[0];
        const expected = count(staticRender(example).target, tag);
        const { target, result } = staticRender(withoutAttribute(example, tag, name));
        expect(count(target, tag)).toBe(expected - 1);
        expect(result.diagnostics.map((d) => d.code)).toContain(
          ContractDiagnosticCode.MissingAttribute,
        );
      },
    );

    it('keeps component instances through appends and completion; replacement resets them', () => {
      const example = contract.examples[0];
      const stream = streamed();
      stream.send(example);
      const before = [...stream.content().querySelectorAll(everyTag)];
      expect(before.length).toBeGreaterThan(0);

      stream.send('\n\nMore prose arrives after the component.');
      stream.regionDone();
      const after = [...stream.content().querySelectorAll(everyTag)];
      expect(after).toEqual(before);
      expect(after.every((element, index) => element === before[index])).toBe(true);

      const reopened = streamed();
      reopened.send(example);
      const original = [...reopened.content().querySelectorAll(everyTag)];
      reopened.replace(example);
      expect(original.every((element) => !element.isConnected)).toBe(true);
      expect(reopened.content().querySelectorAll(everyTag)).toHaveLength(original.length);
    });
  },
);
