import { DiagnosticSeverity, Parser } from '@htmdjs/parser';
import type { ElementBlock } from '@htmdjs/parser';
import { describe, expect, it } from 'vitest';

import { baseCatalog } from '../src/base.js';
import { resolveChildren, resolveComponent, validateNodes } from '../src/resolve.js';
import { ContractDiagnosticCode } from '../src/types.js';

function element(source: string, streaming = false): ElementBlock {
  const node = Parser.getInstance().parse(source, { streaming }).document.nodes[0];
  if (node?.type !== 'element') {
    throw new Error(`expected an element in ${source}`);
  }
  return node;
}

function codes(source: string, streaming = false): string[] {
  const result = resolveComponent(element(source, streaming), baseCatalog, { streaming });
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

describe('resolveComponent', () => {
  it('falls back for components missing from the host catalog, even when valid', () => {
    const narrowed = baseCatalog.without('data-table');
    const result = resolveComponent(element('<data-table src="/api/x"/>'), narrowed);
    expect(result.resolution.kind).toBe('fallback');
    expect(result.diagnostics[0]?.code).toBe(ContractDiagnosticCode.UnknownComponent);
  });

  it('rejects unsupported pinned versions before inspecting attributes', () => {
    expect(codes('<image-card data-htmd-version="2"/>')).toEqual([
      ContractDiagnosticCode.UnsupportedVersion,
    ]);
    const current = resolveComponent(
      element('<refine-prompt data-htmd-version="1" target="$.a"/>'),
      baseCatalog,
    );
    expect(current.resolution).toMatchObject({ kind: 'render', attrs: { target: '$.a' } });
  });

  it('defers complete-policy components while streaming and falls back if they never close', () => {
    const streaming = resolveComponent(element('<choice-item value="a">Del', true), baseCatalog, {
      streaming: true,
    });
    expect(streaming.resolution.kind).toBe('defer');
    expect(streaming.diagnostics).toEqual([]);

    const final = resolveComponent(element('<choice-item value="a">Del'), baseCatalog);
    expect(final.resolution.kind).toBe('fallback');
    expect(final.diagnostics.map((d) => d.code)).toContain(
      ContractDiagnosticCode.IncompleteComponent,
    );
  });

  it('renders progressive components before their closing tag', () => {
    const result = resolveComponent(
      element('<choice-group name="q"><choice-item value="a">A</choice-item>', true),
      baseCatalog,
      { streaming: true },
    );
    expect(result.resolution.kind).toBe('render');
  });

  it('drops undeclared attributes, including runtime-owned state, without failing', () => {
    const result = resolveComponent(
      element('<choice-item value="a" selected="" data-x="1">A</choice-item>'),
      baseCatalog,
    );
    expect(result.resolution).toMatchObject({ kind: 'render', attrs: { value: 'a' } });
    expect(result.resolution.kind === 'render' && result.resolution.attrs).not.toHaveProperty(
      'selected',
    );
    expect(result.diagnostics.map((d) => [d.code, d.severity])).toEqual([
      [ContractDiagnosticCode.UnknownAttribute, DiagnosticSeverity.Warning],
      [ContractDiagnosticCode.UnknownAttribute, DiagnosticSeverity.Warning],
    ]);
  });

  it('falls back on invalid or missing required attributes and reports each', () => {
    expect(codes('<image-card src="/a.png" width="-3"/>')).toEqual([
      ContractDiagnosticCode.InvalidAttribute,
      ContractDiagnosticCode.MissingAttribute,
    ]);
    const result = resolveComponent(element('<refine-prompt target="answer"/>'), baseCatalog);
    expect(result.resolution.kind).toBe('fallback');
  });

  it('applies component rules: duplicate choices warn, invalid fragment payloads fail', () => {
    const duplicate = resolveComponent(
      element(
        '<choice-group name="q"><choice-item value="a">A</choice-item><choice-item value="a">B</choice-item></choice-group>',
      ),
      baseCatalog,
    );
    expect(duplicate.resolution.kind).toBe('render');
    expect(duplicate.diagnostics.map((d) => d.code)).toEqual([
      ContractDiagnosticCode.ComponentRule,
    ]);

    const fragment = resolveComponent(
      element('<htmd-fragment>{"tag": 3}</htmd-fragment>'),
      baseCatalog,
    );
    expect(fragment.resolution.kind).toBe('fallback');
  });
});

describe('resolveChildren', () => {
  it('keeps only allowed components and reports dropped content', () => {
    const node = element(
      '<choice-group name="q">\n  intro text\n  <choice-item value="a">A</choice-item>\n  <data-table src="/x"/>\n</choice-group>',
    );
    const contract = baseCatalog.get('choice-group');
    if (contract === undefined) throw new Error('missing contract');
    const result = resolveChildren(node, contract);
    expect(result.children.map((child) => (child.type === 'element' ? child.tag : 'md'))).toEqual([
      'choice-item',
    ]);
    expect(result.diagnostics.map((d) => d.message)).toEqual([
      '<choice-group> does not accept text content; ignored',
      '<choice-group> does not accept <data-table>; ignored',
    ]);
  });
});

describe('validateNodes', () => {
  it('validates nested components exactly as they will render', () => {
    const { document } = Parser.getInstance().parse(
      '<chat-message author="agent">\n\n<choice-group name="q"><choice-item>no value</choice-item></choice-group>\n\n</chat-message>',
    );
    expect(validateNodes(document.nodes, baseCatalog).map((d) => [d.tag, d.code])).toEqual([
      ['choice-item', ContractDiagnosticCode.MissingAttribute],
    ]);
  });

  it('accepts every base contract example without diagnostics', () => {
    for (const contract of baseCatalog.contracts()) {
      for (const example of contract.examples) {
        const { document, diagnostics } = Parser.getInstance().parse(example);
        expect(diagnostics, example).toEqual([]);
        expect(validateNodes(document.nodes, baseCatalog), example).toEqual([]);
      }
    }
  });
});
