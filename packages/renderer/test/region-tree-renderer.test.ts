import { baseCatalog, createHost, requestHtmdHost } from '@htmdjs/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RegionTreeRenderer } from '../src/region-tree-renderer.js';
import type { RenderLimits } from '../src/region-tree-renderer.js';
import { RendererEvents } from '../src/renderer-events.js';
import type { RegionUpdatedDetail, RendererErrorDetail } from '../src/renderer-events.js';

let root: HTMLDivElement;
let renderer: RegionTreeRenderer;

function container(): HTMLDivElement {
  const element = document.createElement('div');
  document.body.appendChild(element);
  return element;
}

function collectErrors(target: RegionTreeRenderer): RendererErrorDetail[] {
  const errors: RendererErrorDetail[] = [];
  target.addEventListener(RendererEvents.Error, ((event: CustomEvent<RendererErrorDetail>) => {
    errors.push(event.detail);
  }) as EventListener);
  return errors;
}

beforeEach(() => {
  document.body.innerHTML = '';
  root = document.createElement('div');
  document.body.appendChild(root);
  renderer = new RegionTreeRenderer(root);
});

describe('event handling — one type at a time', () => {
  it('doc-open emits DocOpen and stores nothing in the DOM', () => {
    const listener = vi.fn();
    renderer.addEventListener(RendererEvents.DocOpen, listener);

    expect(renderer.apply({ type: 'doc-open', seq: 0, id: 'd', schemaVersion: '0.1' })).toBe(true);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(root.children).toHaveLength(0);
  });

  it('region creates an element attached to the root', () => {
    renderer.apply({
      type: 'region',
      seq: 0,
      id: '$.msg',
      tag: 'chat-message',
      attrs: { author: 'agent' },
    });

    const element = root.querySelector('[data-htmd-region="$.msg"]');
    expect(element?.tagName.toLowerCase()).toBe('chat-message');
  });

  it('region applies validated component attrs only', () => {
    renderer.apply({
      type: 'region',
      seq: 0,
      id: '$.msg',
      tag: 'chat-message',
      attrs: { author: 'agent', onclick: 'alert(1)', style: 'position:fixed' },
    });

    const element = root.querySelector('[data-htmd-region="$.msg"]');
    expect(element?.tagName.toLowerCase()).toBe('chat-message');
    expect(element?.getAttribute('author')).toBe('agent');
    expect(element?.getAttribute('onclick')).toBeNull();
    expect(element?.getAttribute('style')).toBeNull();
  });

  it('region with a forbidden tag falls back to div with a recoverable error', () => {
    const errors: RendererErrorDetail[] = [];
    renderer.addEventListener(RendererEvents.Error, ((event: CustomEvent<RendererErrorDetail>) => {
      errors.push(event.detail);
    }) as EventListener);

    renderer.apply({ type: 'region', seq: 0, id: '$.bad', tag: 'script' });

    const element = root.querySelector('[data-htmd-region="$.bad"]');
    expect(element?.tagName.toLowerCase()).toBe('div');
    expect(errors[0]?.recoverable).toBe(true);
  });

  it('stream materializes markdown into the target region content', () => {
    renderer.apply({ type: 'stream', seq: 0, target: '$.msg.body', chunk: '# Hi\n\nText.' });

    const body = root.querySelector('[data-htmd-region="$.msg.body"]');
    expect(body?.querySelector('[data-htmd-content] h1')?.textContent).toBe('Hi');
  });

  it('stream appends across chunks and re-renders the region only', () => {
    renderer.apply({ type: 'stream', seq: 0, target: '$.a', chunk: 'One ' });
    renderer.apply({ type: 'stream', seq: 1, target: '$.b', chunk: 'Other' });
    renderer.apply({ type: 'stream', seq: 2, target: '$.a', chunk: 'Two' });

    expect(root.querySelector('[data-htmd-region="$.a"]')?.textContent).toContain('One Two');
    expect(root.querySelector('[data-htmd-region="$.b"]')?.textContent).toContain('Other');
  });

  it('region-done marks the region', () => {
    renderer.apply({ type: 'region', seq: 0, id: '$.msg', tag: 'div' });
    renderer.apply({ type: 'region-done', seq: 1, id: '$.msg' });

    expect(root.querySelector('[data-htmd-region="$.msg"]')?.hasAttribute('data-htmd-done')).toBe(
      true,
    );
  });

  it('region-replace swaps the body', () => {
    renderer.apply({ type: 'stream', seq: 0, target: '$.msg', chunk: 'old content' });
    renderer.apply({ type: 'region-replace', seq: 1, id: '$.msg', body: 'new content' });

    const region = root.querySelector('[data-htmd-region="$.msg"]');
    expect(region?.textContent).toContain('new content');
    expect(region?.textContent).not.toContain('old content');
  });

  it('doc-done emits DocDone', () => {
    const listener = vi.fn();
    renderer.addEventListener(RendererEvents.DocDone, listener);

    renderer.apply({ type: 'doc-done', seq: 0, id: 'd' });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('error events surface as RendererEvents.Error', () => {
    const errors: RendererErrorDetail[] = [];
    renderer.addEventListener(RendererEvents.Error, ((event: CustomEvent<RendererErrorDetail>) => {
      errors.push(event.detail);
    }) as EventListener);

    renderer.apply({ type: 'error', seq: 0, region: '$.msg', message: 'boom', recoverable: false });

    expect(errors[0]).toEqual({ message: 'boom', regionId: '$.msg', recoverable: false });
  });
});

describe('region id resolution', () => {
  it('derives the parent from the id path when parent is omitted', () => {
    renderer.apply({ type: 'region', seq: 0, id: '$.msg', tag: 'chat-message' });
    renderer.apply({ type: 'region', seq: 1, id: '$.msg.body', tag: 'div' });

    const body = root.querySelector('[data-htmd-region="$.msg"] > [data-htmd-region="$.msg.body"]');
    expect(body).not.toBeNull();
  });

  it('honours an explicit parent over the path', () => {
    renderer.apply({ type: 'region', seq: 0, id: '$.a', tag: 'div' });
    renderer.apply({ type: 'region', seq: 1, id: '$.orphan', tag: 'div', parent: '$.a' });

    const nested = root.querySelector('[data-htmd-region="$.a"] > [data-htmd-region="$.orphan"]');
    expect(nested).not.toBeNull();
  });

  it('creates implicit ancestor chains for deep targets', () => {
    renderer.apply({ type: 'stream', seq: 0, target: '$.a.b.c', chunk: 'deep' });

    const chain = root.querySelector(
      '[data-htmd-region="$.a"] [data-htmd-region="$.a.b"] [data-htmd-region="$.a.b.c"]',
    );
    expect(chain?.textContent).toContain('deep');
  });

  it('streaming to $ targets the root itself', () => {
    renderer.apply({ type: 'stream', seq: 0, target: '$', chunk: 'root text' });

    expect(root.textContent).toContain('root text');
    expect(root.getAttribute('data-htmd-region')).toBe('$');
  });

  it('duplicate region declarations are idempotent', () => {
    renderer.apply({
      type: 'region',
      seq: 0,
      id: '$.msg',
      tag: 'chat-message',
      attrs: { author: 'agent' },
    });
    renderer.apply({ type: 'region', seq: 1, id: '$.msg', tag: 'div' });

    const matches = root.querySelectorAll('[data-htmd-region="$.msg"]');
    expect(matches).toHaveLength(1);
    expect(matches[0]?.tagName.toLowerCase()).toBe('chat-message');
  });

  it('a declared region reuses the implicit region created by an earlier stream', () => {
    renderer.apply({ type: 'stream', seq: 0, target: '$.msg.body', chunk: 'early' });
    renderer.apply({ type: 'region', seq: 1, id: '$.msg', tag: 'chat-message' });

    const matches = root.querySelectorAll('[data-htmd-region="$.msg"]');
    expect(matches).toHaveLength(1);
    expect(matches[0]?.tagName.toLowerCase()).toBe('div');
  });
});

describe('malformed input', () => {
  it('rejects malformed events without crashing', () => {
    const errors: RendererErrorDetail[] = [];
    renderer.addEventListener(RendererEvents.Error, ((event: CustomEvent<RendererErrorDetail>) => {
      errors.push(event.detail);
    }) as EventListener);

    expect(renderer.apply({ type: 'nope' })).toBe(false);
    expect(renderer.apply(undefined)).toBe(false);
    expect(renderer.apply('garbage')).toBe(false);
    expect(renderer.apply({ type: 'stream', seq: 0 })).toBe(false);

    expect(errors).toHaveLength(4);
    expect(errors.every((detail) => detail.recoverable)).toBe(true);
  });

  it('rejects an invalid region id shape', () => {
    expect(renderer.apply({ type: 'region', seq: 0, id: 'no-dollar', tag: 'div' })).toBe(false);
  });
});

describe('seq handling and resume', () => {
  it('skips events at or below the last applied seq', () => {
    renderer.apply({ type: 'stream', seq: 0, target: '$.a', chunk: 'one' });
    renderer.apply({ type: 'stream', seq: 0, target: '$.a', chunk: 'one' });
    renderer.apply({ type: 'stream', seq: 1, target: '$.a', chunk: ' two' });

    expect(root.querySelector('[data-htmd-region="$.a"]')?.textContent?.trim()).toBe('one two');
    expect(renderer.lastAppliedSeq).toBe(1);
  });

  it('reset clears the tree and the seq cursor', () => {
    renderer.apply({ type: 'stream', seq: 5, target: '$.a', chunk: 'x' });
    renderer.reset();

    expect(root.children).toHaveLength(0);
    expect(renderer.lastAppliedSeq).toBe(-1);
    expect(renderer.regionIds()).toEqual(['$']);
  });

  it('applyAll returns the number of accepted events', () => {
    const accepted = renderer.applyAll([
      { type: 'doc-open', seq: 0, id: 'd', schemaVersion: '0.1' },
      { type: 'broken' },
      { type: 'doc-done', seq: 1, id: 'd' },
    ]);

    expect(accepted).toBe(2);
  });
});

describe('document and region lifecycle', () => {
  it('rejects unsupported versions and mismatched completion without consuming their sequence', () => {
    const errors: RendererErrorDetail[] = [];
    const completed = vi.fn();
    renderer.addEventListener(RendererEvents.Error, ((event: CustomEvent<RendererErrorDetail>) => {
      errors.push(event.detail);
    }) as EventListener);
    renderer.addEventListener(RendererEvents.DocDone, completed);

    expect(renderer.apply({ type: 'doc-open', seq: 0, id: 'd', schemaVersion: '99.0' })).toBe(
      false,
    );
    expect(renderer.lastAppliedSeq).toBe(-1);
    expect(renderer.apply({ type: 'doc-open', seq: 0, id: 'd', schemaVersion: '0.1' })).toBe(true);
    expect(renderer.apply({ type: 'doc-done', seq: 1, id: 'other' })).toBe(false);
    expect(renderer.lastAppliedSeq).toBe(0);
    expect(completed).not.toHaveBeenCalled();
    expect(renderer.apply({ type: 'stream', seq: 1, target: '$', chunk: 'still open' })).toBe(true);
    expect(root.textContent).toBe('still open');
    expect(errors).toHaveLength(2);
    expect(errors.every((error) => error.recoverable)).toBe(true);
  });

  it('seals a completed document, preserves replay, and requires reset for another document', () => {
    renderer.apply({ type: 'doc-open', seq: 0, id: 'd', schemaVersion: '0.1' });
    renderer.apply({ type: 'stream', seq: 1, target: '$.body', chunk: 'finished' });
    const done = { type: 'doc-done', seq: 2, id: 'd' };
    renderer.apply(done);

    expect(renderer.apply({ type: 'stream', seq: 3, target: '$.body', chunk: ' late' })).toBe(
      false,
    );
    expect(renderer.apply({ type: 'region-replace', seq: 3, id: '$.body', body: 'late' })).toBe(
      false,
    );
    expect(renderer.apply({ type: 'region', seq: 3, id: '$.new', tag: 'div' })).toBe(false);
    expect(renderer.apply({ type: 'doc-open', seq: 3, id: 'next', schemaVersion: '0.1' })).toBe(
      false,
    );
    expect(renderer.apply(done)).toBe(true);
    expect(renderer.lastAppliedSeq).toBe(2);
    expect(root.textContent).toBe('finished');
    expect(renderer.regionElement('$.new')).toBeUndefined();

    renderer.reset();
    expect(root.hasAttribute('data-htmd-done')).toBe(false);
    expect(root.hasAttribute('data-htmd-pending')).toBe(false);
    expect(renderer.apply({ type: 'doc-open', seq: 0, id: 'next', schemaVersion: '0.1' })).toBe(
      true,
    );
    expect(renderer.apply({ type: 'stream', seq: 1, target: '$', chunk: 'new document' })).toBe(
      true,
    );
    expect(root.textContent).toBe('new document');
  });

  it('does not allow an explicit document to replace an active fragment context', () => {
    renderer.apply({ type: 'stream', seq: 0, target: '$', chunk: 'fragment' });
    expect(renderer.apply({ type: 'doc-open', seq: 1, id: 'new', schemaVersion: '0.1' })).toBe(
      false,
    );
    expect(renderer.lastAppliedSeq).toBe(0);
    expect(renderer.apply({ type: 'doc-done', seq: 1, id: 'implicit' })).toBe(true);
    expect(root.hasAttribute('data-htmd-done')).toBe(true);
  });

  it('terminates on a fatal error without reporting successful completion', () => {
    const completed = vi.fn();
    renderer.addEventListener(RendererEvents.DocDone, completed);
    renderer.apply({ type: 'stream', seq: 0, target: '$', chunk: 'partial' });
    renderer.apply({ type: 'error', seq: 1, message: 'interrupted', recoverable: false });

    expect(renderer.apply({ type: 'stream', seq: 2, target: '$', chunk: ' late' })).toBe(false);
    expect(renderer.apply({ type: 'doc-done', seq: 2, id: 'd' })).toBe(false);
    expect(renderer.lastAppliedSeq).toBe(1);
    expect(root.textContent).toBe('partial');
    expect(root.hasAttribute('data-htmd-done')).toBe(false);
    expect(completed).not.toHaveBeenCalled();
  });

  it('seals the actual subtree and permits replacement only under open ancestors', () => {
    renderer.apply({ type: 'region', seq: 0, id: '$.parent', tag: 'section' });
    renderer.apply({ type: 'region', seq: 1, id: '$.child', parent: '$.parent', tag: 'div' });
    renderer.apply({ type: 'region', seq: 2, id: '$.parent.external', parent: '$', tag: 'div' });
    renderer.apply({ type: 'stream', seq: 3, target: '$.child', chunk: 'child' });
    renderer.apply({ type: 'region-done', seq: 4, id: '$.parent' });

    expect(renderer.regionElement('$.child')?.hasAttribute('data-htmd-done')).toBe(true);
    expect(renderer.regionElement('$.parent.external')?.hasAttribute('data-htmd-done')).toBe(false);
    expect(renderer.apply({ type: 'stream', seq: 5, target: '$.child', chunk: ' late' })).toBe(
      false,
    );
    expect(renderer.apply({ type: 'stream', seq: 5, target: '$.parent.new', chunk: 'late' })).toBe(
      false,
    );
    expect(
      renderer.apply({ type: 'region', seq: 5, id: '$.new', parent: '$.parent', tag: 'div' }),
    ).toBe(false);
    expect(renderer.apply({ type: 'region-replace', seq: 5, id: '$.child', body: 'late' })).toBe(
      false,
    );
    expect(renderer.lastAppliedSeq).toBe(4);
    expect(renderer.regionElement('$.parent.new')).toBeUndefined();
    expect(renderer.regionElement('$.new')).toBeUndefined();
    expect(
      renderer.apply({ type: 'stream', seq: 5, target: '$.parent.external', chunk: 'outside' }),
    ).toBe(true);
    expect(
      renderer.apply({ type: 'region-replace', seq: 6, id: '$.parent', body: 'reopened' }),
    ).toBe(true);
    expect(renderer.regionElement('$.parent')?.hasAttribute('data-htmd-done')).toBe(false);
    expect(renderer.apply({ type: 'stream', seq: 7, target: '$.parent', chunk: ' again' })).toBe(
      true,
    );
    expect(renderer.regionElement('$.parent')?.textContent).toBe('reopened again');
  });

  it('unregisters actual replacement descendants without removing external path descendants', () => {
    renderer.apply({ type: 'region', seq: 0, id: '$.parent', tag: 'section' });
    renderer.apply({ type: 'region', seq: 1, id: '$.child', parent: '$.parent', tag: 'div' });
    renderer.apply({ type: 'stream', seq: 2, target: '$.child.deep', chunk: 'old child' });
    renderer.apply({ type: 'region', seq: 3, id: '$.parent.external', parent: '$', tag: 'div' });
    renderer.apply({ type: 'stream', seq: 4, target: '$.parent.external', chunk: 'outside' });
    const removed = renderer.regionElement('$.child');
    const preserved = renderer.regionElement('$.parent.external');
    renderer.apply({ type: 'region-replace', seq: 5, id: '$.parent', body: 'replacement' });

    expect(renderer.regionElement('$.child')).toBeUndefined();
    expect(renderer.regionElement('$.child.deep')).toBeUndefined();
    expect(removed?.isConnected).toBe(false);
    expect(renderer.regionElement('$.parent.external')).toBe(preserved);
    expect(preserved?.isConnected).toBe(true);
    expect(preserved?.textContent).toBe('outside');
    expect(renderer.regionIds().every((id) => renderer.regionElement(id)?.isConnected)).toBe(true);
    renderer.apply({ type: 'stream', seq: 6, target: '$.child', chunk: 'new child' });
    expect(renderer.regionElement('$.child')?.isConnected).toBe(true);
    expect(renderer.regionElement('$.child')?.textContent).toBe('new child');
  });

  it('rejects self-parenting and implicit ancestry cycles before creating regions', () => {
    expect(renderer.apply({ type: 'region', seq: 0, id: '$.a', parent: '$.a', tag: 'div' })).toBe(
      false,
    );
    expect(
      renderer.apply({ type: 'region', seq: 0, id: '$.a', parent: '$.a.child', tag: 'div' }),
    ).toBe(false);
    expect(renderer.regionIds()).toEqual(['$']);
    expect(renderer.lastAppliedSeq).toBe(-1);
    expect(renderer.apply({ type: 'region', seq: 0, id: '$.a', parent: '$', tag: 'div' })).toBe(
      true,
    );
    renderer.apply({ type: 'region', seq: 1, id: '$.b', parent: '$.a', tag: 'div' });
    expect(renderer.apply({ type: 'region', seq: 2, id: '$.a', parent: '$.b', tag: 'div' })).toBe(
      false,
    );
    expect(renderer.lastAppliedSeq).toBe(1);
    expect(renderer.regionElement('$.a')?.contains(renderer.regionElement('$.b') ?? null)).toBe(
      true,
    );
  });

  it('finalizes pending descendant source on ancestor completion and reports final diagnostics', () => {
    const updates: RegionUpdatedDetail[] = [];
    renderer.addEventListener(RendererEvents.RegionUpdated, ((
      event: CustomEvent<RegionUpdatedDetail>,
    ) => {
      updates.push(event.detail);
    }) as EventListener);
    renderer.apply({ type: 'region', seq: 0, id: '$.parent', tag: 'section' });
    renderer.apply({ type: 'region', seq: 1, id: '$.child', parent: '$.parent', tag: 'div' });
    renderer.apply({
      type: 'stream',
      seq: 2,
      target: '$.child',
      chunk: 'Visible\n\n<image-card src="',
    });
    const child = renderer.regionElement('$.child');
    expect(child?.hasAttribute('data-htmd-pending')).toBe(true);
    expect(child?.textContent).not.toContain('<image-card');
    expect(updates.at(-1)?.diagnostics).toEqual([]);

    renderer.apply({ type: 'region-done', seq: 3, id: '$.parent' });
    expect(child?.hasAttribute('data-htmd-pending')).toBe(false);
    expect(child?.hasAttribute('data-htmd-done')).toBe(true);
    expect(child?.textContent).toContain('<image-card src="');
    expect(updates.at(-1)?.id).toBe('$.child');
    expect(updates.at(-1)?.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'incomplete-tag' })]),
    );
  });

  it('finalizes every remaining buffer before notifying document completion', () => {
    renderer.apply({ type: 'stream', seq: 0, target: '$.a', chunk: '<x-panel>unfinished' });
    renderer.apply({ type: 'stream', seq: 1, target: '$.b', chunk: '<image-card src="' });
    let completedText: string | null = null;
    let completedPending = true;
    let completedRegionsDone = false;
    renderer.addEventListener(RendererEvents.DocDone, () => {
      completedText = root.textContent;
      completedPending = root.querySelector('[data-htmd-pending]') !== null;
      completedRegionsDone = renderer
        .regionIds()
        .every((id) => renderer.regionElement(id)?.hasAttribute('data-htmd-done'));
    });

    expect(renderer.apply({ type: 'doc-done', seq: 2, id: 'implicit' })).toBe(true);
    expect(completedText).toContain('unfinished');
    expect(completedText).toContain('<image-card src="');
    expect(completedPending).toBe(false);
    expect(completedRegionsDone).toBe(true);
  });
});

describe('host and component catalog', () => {
  it('uses <div> with a recoverable error for region components that cannot hold region content', () => {
    customElements.define('region-probe', class extends HTMLElement {});
    const errors = collectErrors(renderer);
    renderer.applyAll([
      { type: 'region', seq: 0, id: '$.unknown', tag: 'region-probe' },
      { type: 'region', seq: 1, id: '$.invalid', tag: 'chat-message', attrs: { author: 'robot' } },
      {
        type: 'region',
        seq: 2,
        id: '$.leaf',
        tag: 'image-card',
        attrs: { src: '/x.png', alt: 'x' },
      },
    ]);

    for (const id of ['$.unknown', '$.invalid', '$.leaf']) {
      expect(renderer.regionElement(id)?.tagName.toLowerCase(), id).toBe('div');
      expect(renderer.regionElement(id)?.attributes, id).toHaveLength(1);
    }
    expect(errors.map((error) => [error.regionId, error.recoverable])).toEqual([
      ['$.unknown', true],
      ['$.invalid', true],
      ['$.leaf', true],
    ]);
  });

  it('provides its host and resolves region content through the host catalog', () => {
    const host = createHost({ components: baseCatalog.without('data-table') });
    const hosted = new RegionTreeRenderer(container(), { host });
    const updates: RegionUpdatedDetail[] = [];
    hosted.addEventListener(RendererEvents.RegionUpdated, ((
      event: CustomEvent<RegionUpdatedDetail>,
    ) => {
      updates.push(event.detail);
    }) as EventListener);

    hosted.apply({
      type: 'stream',
      seq: 0,
      target: '$.body',
      chunk: '<data-table src="/x"/>\n\n<code-block>**raw**</code-block>',
    });

    const body = hosted.regionElement('$.body');
    if (body === undefined) throw new Error('Missing body region');
    expect(body.querySelector('data-table')).toBeNull();
    expect(body.querySelector('[data-htmd-fallback="data-table"]')).not.toBeNull();
    expect(body.querySelector('code-block')?.textContent).toBe('**raw**');
    expect(updates.at(-1)?.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'unknown-component',
    ]);
    expect(requestHtmdHost(body)).toBe(host);
  });
});

describe('render limits', () => {
  function limited(limits: Partial<RenderLimits>): {
    readonly target: RegionTreeRenderer;
    readonly errors: RendererErrorDetail[];
  } {
    const target = new RegionTreeRenderer(container(), { limits });
    return { target, errors: collectErrors(target) };
  }

  function expectClosedAfter(
    target: RegionTreeRenderer,
    errors: readonly RendererErrorDetail[],
    regionId: string,
    lastSeq: number,
  ): void {
    expect(errors.at(-1)).toMatchObject({ regionId, recoverable: false });
    expect(target.lastAppliedSeq).toBe(lastSeq);
    expect(target.apply({ type: 'stream', seq: lastSeq + 1, target: '$', chunk: 'late' })).toBe(
      false,
    );
    expect(target.regionElement('$')?.textContent).not.toContain('late');
  }

  it('counts implicit regions against maxRegions', () => {
    const { target, errors } = limited({ maxRegions: 2 });
    expect(target.apply({ type: 'stream', seq: 0, target: '$.a.b', chunk: 'ok' })).toBe(true);
    expect(target.apply({ type: 'stream', seq: 1, target: '$.c.d', chunk: 'no' })).toBe(false);

    expect(target.regionIds()).toEqual(['$', '$.a', '$.a.b']);
    expectClosedAfter(target, errors, '$.c.d', 0);
  });

  it('measures maxRegionDepth along explicit parents', () => {
    const { target, errors } = limited({ maxRegionDepth: 2 });
    target.apply({ type: 'region', seq: 0, id: '$.a', tag: 'div' });
    target.apply({ type: 'region', seq: 1, id: '$.b', tag: 'div', parent: '$.a' });
    expect(target.apply({ type: 'region', seq: 2, id: '$.c', tag: 'div', parent: '$.b' })).toBe(
      false,
    );

    expect(target.regionElement('$.c')).toBeUndefined();
    expectClosedAfter(target, errors, '$.c', 1);
  });

  it('bounds one region buffer in UTF-8 bytes after appends and replacements', () => {
    const { target, errors } = limited({ maxRegionBytes: 8 });
    target.apply({ type: 'stream', seq: 0, target: '$.a', chunk: 'abcd' });
    expect(target.apply({ type: 'stream', seq: 1, target: '$.a', chunk: 'éfgh' })).toBe(false);
    expect(target.regionElement('$.a')?.textContent).toBe('abcd');
    expectClosedAfter(target, errors, '$.a', 0);

    const replaced = limited({ maxRegionBytes: 8 });
    replaced.target.apply({ type: 'stream', seq: 0, target: '$.a', chunk: 'abcd' });
    expect(
      replaced.target.apply({ type: 'region-replace', seq: 1, id: '$.a', body: '123456789' }),
    ).toBe(false);
    expect(replaced.errors.at(-1)).toMatchObject({ regionId: '$.a', recoverable: false });
  });

  it('bounds the live buffered bytes of the whole document', () => {
    const { target, errors } = limited({ maxDocumentBytes: 10 });
    target.apply({ type: 'stream', seq: 0, target: '$.a', chunk: '123456' });
    target.apply({ type: 'stream', seq: 1, target: '$.a.child', chunk: '1234' });
    // Replacing `$.a` releases its own buffer and its descendants'.
    target.apply({ type: 'region-replace', seq: 2, id: '$.a', body: '1' });
    expect(target.apply({ type: 'stream', seq: 3, target: '$.b', chunk: '123456789' })).toBe(true);
    expect(target.apply({ type: 'stream', seq: 4, target: '$.b', chunk: '!' })).toBe(false);

    expect(target.regionElement('$.b')?.textContent).toBe('123456789');
    expectClosedAfter(target, errors, '$.b', 3);
  });
});
