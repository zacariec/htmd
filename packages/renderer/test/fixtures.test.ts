import { ComponentEvents, baseCatalog, createHost } from '@htmdjs/contracts';
import type { ChoiceDetail, RefineDetail } from '@htmdjs/contracts';
import {
  ChatMessage,
  HtmdFragment,
  registerHtmdElements,
  setHtmdElementsLogSink,
} from '@htmdjs/elements';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RegionTreeRenderer } from '../src/region-tree-renderer.js';
import { loadFixture } from './helpers.js';

let root: HTMLDivElement;
let renderer: RegionTreeRenderer;

function region(id: string): Element {
  const element = root.querySelector(`[data-htmd-region="${cssEscape(id)}"]`);
  if (element === null) {
    throw new Error(`region ${id} not found`);
  }
  return element;
}

function cssEscape(id: string): string {
  return id.replace(/([$.])/g, '\\$1');
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeAll(() => {
  registerHtmdElements();
  setHtmdElementsLogSink({ warn: () => {}, error: () => {} });
});

beforeEach(() => {
  document.body.innerHTML = '';
  root = document.createElement('div');
  document.body.appendChild(root);
  // Fixture documents load table data; the default host never authorizes data.
  renderer = new RegionTreeRenderer(root, {
    host: createHost({ components: baseCatalog, authorizeUrl: () => true }),
  });
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ columns: ['week', 'revenue'], rows: [{ week: 'w51', revenue: 120 }] }),
    }),
  );
});

describe('01-single-message', () => {
  it('materializes a message with prose and a data-table', async () => {
    const events = loadFixture('01-single-message.jsonl');
    expect(renderer.applyAll(events)).toBe(events.length);
    await settle();

    const message = region('$.msg');
    expect(message.tagName.toLowerCase()).toBe('chat-message');
    expect(message).toBeInstanceOf(ChatMessage);
    expect(message.getAttribute('author')).toBe('agent');

    const body = region('$.msg.body');
    expect(body.textContent).toContain('Looking at the Q4 numbers now.');
    expect(body.querySelector('strong')?.textContent).toBe('up 12%');

    const table = body.querySelector('data-table');
    expect(table).not.toBeNull();
    expect(table?.getAttribute('src')).toBe('/api/sales/q4');
    expect(body.hasAttribute('data-htmd-done')).toBe(true);
  });

  it('shows partial prose at an intermediate frame', () => {
    const events = loadFixture('01-single-message.jsonl');
    renderer.applyAll(events.slice(0, 3));

    const body = region('$.msg.body');
    expect(body.textContent).toContain('Looking at the Q4 numbers now.');
    expect(body.querySelector('data-table')).toBeNull();
  });
});

describe('02-ordered-fill', () => {
  it('fills intro, body, outro in order', () => {
    renderer.applyAll(loadFixture('02-ordered-fill.jsonl'));

    expect(region('$.msg.intro').querySelector('h1')?.textContent).toBe('Plan');
    expect(region('$.msg.body').querySelectorAll('ol li')).toHaveLength(3);
    expect(region('$.msg.outro').querySelector('em')?.textContent).toBe('go');

    const ids = [...region('$.msg').children].map((child) =>
      child.getAttribute('data-htmd-region'),
    );
    expect(ids).toEqual(['$.msg.intro', '$.msg.body', '$.msg.outro']);
  });
});

describe('03-out-of-order', () => {
  it('materializes the conclusion before the body arrives', () => {
    const events = loadFixture('03-out-of-order.jsonl');
    renderer.applyAll(events.slice(0, 7));

    expect(region('$.msg.conclusion').textContent).toContain('ship it');
    expect(region('$.msg.body').textContent?.trim()).toBe('');

    renderer.applyAll(events);
    expect(region('$.msg.body').querySelectorAll('ul li')).toHaveLength(3);

    const ids = [...region('$.msg').children].map((child) =>
      child.getAttribute('data-htmd-region'),
    );
    expect(ids).toEqual(['$.msg.intro', '$.msg.body', '$.msg.conclusion']);
  });
});

describe('04-region-replace', () => {
  it('rebuilds the region and disposes the old subtree', () => {
    const events = loadFixture('04-region-replace.jsonl');
    renderer.applyAll(events.slice(0, 6));

    expect(region('$.msg.body').textContent).toContain('42');
    expect(renderer.regionIds()).toContain('$.msg.body.details');

    renderer.applyAll(events);

    const body = region('$.msg.body');
    expect(body.textContent).toContain('54');
    expect(body.textContent).not.toContain('42');
    expect(body.textContent).not.toContain('wrong dataset');
    expect(renderer.regionIds()).not.toContain('$.msg.body.details');
    expect(root.querySelectorAll('[data-htmd-region="\\$\\.msg\\.body\\.details"]')).toHaveLength(
      0,
    );
    expect(body.querySelector('image-card')?.getAttribute('alt')).toBe('Corrected chart');
    expect(body.hasAttribute('data-htmd-done')).toBe(true);
  });
});

describe('05-nested', () => {
  it('hydrates a fragment streamed across chunks inside a panel', async () => {
    renderer.applyAll(loadFixture('05-nested.jsonl'));
    await settle();

    const panel = region('$.msg.panel');
    expect(panel.tagName.toLowerCase()).toBe('section');

    const fragment = panel.querySelector('htmd-fragment');
    expect(fragment).toBeInstanceOf(HtmdFragment);
    await (fragment as HtmdFragment).updateComplete;

    const shadow = (fragment as HtmdFragment).shadowRoot;
    expect(shadow?.querySelector('h3')?.textContent).toContain('Q4 Summary');
    expect(shadow?.querySelectorAll('li')).toHaveLength(2);
  });
});

describe('06-refine-loop', () => {
  it('replaces the draft after a refine and adds a follow-up region', async () => {
    const events = loadFixture('06-refine-loop.jsonl');
    renderer.applyAll(events.slice(0, 5));
    expect(region('$.msg.body').textContent).toContain('Draft copy');

    renderer.applyAll(events);
    await settle();

    const body = region('$.msg.body');
    expect(body.textContent).toContain('Refined copy');
    expect(body.textContent).not.toContain('Draft copy');
    expect(body.querySelector('refine-prompt')?.getAttribute('target')).toBe('$.msg.body');
    expect(region('$.msg.followup').textContent).toContain('tone');
  });

  it('dispatches the refine event from the streamed prompt', async () => {
    renderer.applyAll(loadFixture('06-refine-loop.jsonl'));
    await settle();

    const refineSpy = vi.fn();
    root.addEventListener(ComponentEvents.Refine, refineSpy as EventListener, { once: true });

    const prompt = region('$.msg.body').querySelector('refine-prompt');
    const promptElement = prompt as HTMLElement & {
      shadowRoot: ShadowRoot;
      updateComplete: Promise<boolean>;
    };
    await promptElement.updateComplete;
    const textarea = promptElement.shadowRoot.querySelector('textarea');
    const form = promptElement.shadowRoot.querySelector('form');
    if (textarea === null || form === null) {
      throw new Error('refine-prompt did not render');
    }
    textarea.value = 'tighter';
    form.dispatchEvent(new Event('submit', { cancelable: true }));

    expect(refineSpy).toHaveBeenCalledTimes(1);
    const event = refineSpy.mock.calls[0]?.[0] as CustomEvent<RefineDetail>;
    expect(event.detail).toEqual({ target: '$.msg.body', prompt: 'tighter', region: '$.msg.body' });
  });
});

describe('07-choice-selection', () => {
  it('streams a choice group that emits selection events', async () => {
    renderer.applyAll(loadFixture('07-choice-selection.jsonl'));
    await settle();

    const choiceSpy = vi.fn();
    root.addEventListener(ComponentEvents.Choice, choiceSpy as EventListener, { once: true });

    const items = region('$.msg.body').querySelectorAll('choice-item');
    expect(items).toHaveLength(3);

    const exportItem = items[1] as HTMLElement & {
      shadowRoot: ShadowRoot;
      updateComplete: Promise<boolean>;
    };
    await exportItem.updateComplete;
    exportItem.shadowRoot.querySelector('button')?.click();

    expect(choiceSpy).toHaveBeenCalledTimes(1);
    const event = choiceSpy.mock.calls[0]?.[0] as CustomEvent<ChoiceDetail>;
    expect(event.detail).toEqual({ name: 'next-step', value: 'export', region: '$.msg.body' });
  });
});

describe('08-resume', () => {
  it('converges to the same DOM as an uninterrupted run', () => {
    const events = loadFixture('08-resume.jsonl');

    const referenceRoot = document.createElement('div');
    document.body.appendChild(referenceRoot);
    const reference = new RegionTreeRenderer(referenceRoot);
    reference.applyAll(events);

    // Connection drops after seq 3; producer replays from seq 2 (overlap).
    renderer.applyAll(events.slice(0, 4));
    expect(renderer.lastAppliedSeq).toBe(3);
    renderer.applyAll(events.slice(2));

    expect(root.innerHTML).toBe(referenceRoot.innerHTML);
    expect(region('$.msg.body').textContent).toContain(
      'Part one of a long answer. Part two arrives before the drop. Part three lands after the reconnect. Part four finishes the paragraph.',
    );
  });
});

describe('09-complex-real-world', () => {
  it('materializes the full multi-region document', async () => {
    const events = loadFixture('09-complex-real-world.jsonl');
    expect(renderer.applyAll(events)).toBe(events.length);
    await settle();

    expect(region('$.msg.intro').querySelector('h1')?.textContent).toBe('Q4 Revenue Review');

    const analysis = region('$.msg.analysis');
    expect(analysis.querySelector('h2')?.textContent).toBe('What the data says');
    expect(analysis.querySelectorAll('ul li')).toHaveLength(3);
    expect(analysis.querySelector('pre code')?.textContent).toContain('invoice.voided');
    expect(analysis.querySelector('data-table')).not.toBeNull();

    const artefacts = region('$.msg.artefacts');
    expect(artefacts.querySelector('image-card')?.getAttribute('width')).toBe('1200');
    expect(artefacts.querySelector('file-preview')?.getAttribute('mime')).toBe('application/pdf');

    const fragment = artefacts.querySelector('htmd-fragment') as HtmdFragment;
    await fragment.updateComplete;
    expect(fragment.shadowRoot?.querySelectorAll('li')).toHaveLength(3);

    const next = region('$.msg.next');
    expect(next.querySelectorAll('choice-item')).toHaveLength(2);
    expect(next.querySelector('refine-prompt')?.getAttribute('target')).toBe('$.msg.analysis');

    for (const id of ['$.msg.intro', '$.msg.analysis', '$.msg.artefacts', '$.msg.next', '$.msg']) {
      expect(region(id).hasAttribute('data-htmd-done'), `${id} done`).toBe(true);
    }
  });
});

describe('10-all-elements', () => {
  it('materializes every custom element in a single message', async () => {
    const events = loadFixture('10-all-elements.jsonl');
    expect(renderer.applyAll(events)).toBe(events.length);
    await settle();

    const message = region('$.msg');
    expect(message.tagName.toLowerCase()).toBe('chat-message');
    expect(message).toBeInstanceOf(ChatMessage);

    const body = region('$.msg.body');

    const codeBlock = body.querySelector('code-block');
    expect(codeBlock).not.toBeNull();
    expect(codeBlock?.getAttribute('language')).toBe('ts');
    expect(codeBlock?.textContent).toContain('orders.reduce');

    const image = body.querySelector('image-card');
    expect(image?.getAttribute('src')).toBe('/charts/q4-revenue.png');
    expect(image?.getAttribute('width')).toBe('1200');

    const table = body.querySelector('data-table');
    expect(table?.getAttribute('src')).toBe('/api/sales/q4');

    const file = body.querySelector('file-preview');
    expect(file?.getAttribute('mime')).toBe('application/pdf');
    expect(file?.getAttribute('href')).toBe('/files/q4-full-report.pdf');

    const fragment = body.querySelector('htmd-fragment') as HtmdFragment;
    await fragment.updateComplete;
    expect(fragment.shadowRoot?.querySelectorAll('li')).toHaveLength(3);

    const group = body.querySelector('choice-group');
    expect(group?.getAttribute('name')).toBe('next');
    expect(body.querySelectorAll('choice-item')).toHaveLength(3);

    const refine = body.querySelector('refine-prompt');
    expect(refine?.getAttribute('target')).toBe('$.msg.body');
    expect(refine?.getAttribute('placeholder')).toBe('Ask a follow-up on this section…');

    expect(body.hasAttribute('data-htmd-done')).toBe(true);
    expect(message.hasAttribute('data-htmd-done')).toBe(true);
  });
});
