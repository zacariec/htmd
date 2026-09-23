import {
  ComponentEvents,
  MAX_TABLE_ROWS,
  baseCatalog,
  createHost,
  provideHtmdHost,
} from '@htmdjs/contracts';
import type { ChoiceDetail, DataRequest, HtmdHostOptions, RefineDetail } from '@htmdjs/contracts';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../src/chat-message.js';
import type { ChoiceGroup } from '../src/choice-group.js';
import type { ChoiceItem } from '../src/choice-item.js';
import type { CodeBlock } from '../src/code-block.js';
import type { DataTable } from '../src/data-table.js';
import type { FilePreview } from '../src/file-preview.js';
import type { ImageCard } from '../src/image-card.js';
import { setHtmdElementsLogSink } from '../src/internal/logger.js';
import type { RefinePrompt } from '../src/refine-prompt.js';
import { registerHtmdElements } from '../src/register-htmd-elements.js';

async function mount<T extends HTMLElement>(
  tag: string,
  attrs: Record<string, string>,
  parent: Element = document.body,
): Promise<T> {
  const element = document.createElement(tag) as T;
  for (const [name, value] of Object.entries(attrs)) {
    element.setAttribute(name, value);
  }
  parent.appendChild(element);
  await (element as unknown as { updateComplete: Promise<boolean> }).updateComplete;
  return element;
}

/** A container whose descendants are governed by a host built from `options`. */
function hostContainer(options: Omit<HtmdHostOptions, 'components'>): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  provideHtmdHost(container, createHost({ components: baseCatalog, ...options }));
  return container;
}

function absolute(path: string): string {
  return new URL(path, document.baseURI).href;
}

beforeAll(() => {
  registerHtmdElements();
  setHtmdElementsLogSink({ warn: () => {}, error: () => {} });
});

beforeEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('registration', () => {
  it('defines all nine base elements', () => {
    for (const tag of [
      'chat-message',
      'choice-group',
      'choice-item',
      'code-block',
      'data-table',
      'file-preview',
      'htmd-fragment',
      'image-card',
      'refine-prompt',
    ]) {
      expect(customElements.get(tag), `expected ${tag} to be defined`).toBeDefined();
    }
  });

  it('is idempotent', () => {
    expect(registerHtmdElements()).toBe(true);
    expect(registerHtmdElements()).toBe(true);
  });
});

describe('chat-message', () => {
  it('is an article labelled by its author and busy only while streaming', async () => {
    const message = await mount<ChatMessage>('chat-message', {
      author: 'agent',
      'author-name': 'Navigator',
      status: 'streaming',
    });

    expect(message.getAttribute('role')).toBe('article');
    expect(message.getAttribute('aria-label')).toBe('Navigator');
    expect(message.getAttribute('aria-busy')).toBe('true');

    message.setAttribute('status', 'complete');
    await message.updateComplete;
    expect(message.hasAttribute('aria-busy')).toBe(false);
  });
});

describe('code-block', () => {
  it('shows a labelled copy button unless show-copy is "false"', async () => {
    const shown = await mount<CodeBlock>('code-block', { 'show-copy': 'true' });
    const hidden = await mount<CodeBlock>('code-block', { 'show-copy': 'false' });

    expect(shown.shadowRoot?.querySelector('button')?.getAttribute('aria-label')).toBe('Copy code');
    expect(hidden.shadowRoot?.querySelector('button')).toBeNull();
  });
});

describe('file-preview', () => {
  it('renders a labelled download link for an authorized href', async () => {
    const preview = await mount<FilePreview>('file-preview', {
      name: 'report.pdf',
      mime: 'application/pdf',
      'size-bytes': '2048',
      href: '/files/report.pdf',
    });

    const anchor = preview.shadowRoot?.querySelector('a');
    expect(anchor?.getAttribute('href')).toBe(absolute('/files/report.pdf'));
    expect(anchor?.getAttribute('aria-label')).toBe('Download report.pdf');
  });

  it('renders no link when the host does not authorize the href', async () => {
    const preview = await mount<FilePreview>('file-preview', {
      name: 'x',
      mime: 'text/plain',
      href: 'https://elsewhere.example/x.txt',
    });

    expect(preview.shadowRoot?.querySelector('a')).toBeNull();
  });
});

describe('image-card', () => {
  it('renders an authorized src', async () => {
    const card = await mount<ImageCard>('image-card', {
      src: '/x.png',
      alt: 'x',
      width: '4',
      height: '3',
    });

    expect(card.shadowRoot?.querySelector('img')?.getAttribute('src')).toBe(absolute('/x.png'));
  });

  it('shows the alt text instead of an image when the host blocks src', async () => {
    const card = await mount<ImageCard>('image-card', {
      src: 'https://elsewhere.example/x.png',
      alt: 'Weekly revenue',
    });

    expect(card.shadowRoot?.querySelector('img')).toBeNull();
    const placeholder = card.shadowRoot?.querySelector('[role="img"]');
    expect(placeholder?.getAttribute('aria-label')).toBe('Weekly revenue');
    expect(placeholder?.textContent).toContain('Weekly revenue');
  });
});

describe('choice-group', () => {
  async function mountGroup(markup: string): Promise<ChoiceItem[]> {
    document.body.innerHTML = markup;
    const group = document.querySelector('choice-group') as ChoiceGroup;
    const items = [...document.querySelectorAll('choice-item')] as ChoiceItem[];
    await group.updateComplete;
    await Promise.all(items.map((item) => item.updateComplete));
    return items;
  }

  function button(item: ChoiceItem | undefined): HTMLButtonElement {
    const found = item?.shadowRoot?.querySelector('button');
    if (found === null || found === undefined) {
      throw new Error('choice-item did not render its button');
    }
    return found;
  }

  function choices(): string[] {
    const values: string[] = [];
    document.addEventListener(ComponentEvents.Choice, (event) => {
      values.push((event as CustomEvent<ChoiceDetail>).detail.value);
    });
    return values;
  }

  it('emits a choice intent attributed to its region and syncs selection', async () => {
    const items = await mountGroup(`
      <div data-htmd-region="$.answer">
        <choice-group name="q1">
          <choice-item value="a">A</choice-item>
          <choice-item value="b">B</choice-item>
        </choice-group>
      </div>
    `);
    const listener = vi.fn();
    document.addEventListener(ComponentEvents.Choice, listener);

    button(items[1]).click();

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0]?.[0] as CustomEvent<ChoiceDetail>;
    expect(event.detail).toEqual({ name: 'q1', value: 'b', region: '$.answer' });
    expect(items.map((item) => item.selected)).toEqual([false, true]);
  });

  it('moves focus and selection with arrow keys, wrapping, and Home/End', async () => {
    const items = await mountGroup(`
      <choice-group name="q2" value="a">
        <choice-item value="a">A</choice-item>
        <choice-item value="b">B</choice-item>
        <choice-item value="c">C</choice-item>
      </choice-group>
    `);
    const emitted = choices();
    const tabStops = (): string[] =>
      items.map((item) => button(item).getAttribute('tabindex') ?? '');
    await Promise.all(items.map((item) => item.updateComplete));
    expect(tabStops()).toEqual(['0', '-1', '-1']);

    const steps: ReadonlyArray<readonly [string, number]> = [
      ['ArrowRight', 1],
      ['ArrowDown', 2],
      ['ArrowRight', 0],
      ['ArrowLeft', 2],
      ['ArrowUp', 1],
      ['Home', 0],
      ['End', 2],
    ];
    let current = 0;
    for (const [key, expected] of steps) {
      button(items[current]).dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true }),
      );
      await Promise.all(items.map((item) => item.updateComplete));
      current = expected;
      expect(items[expected]?.selected, key).toBe(true);
      expect(items[expected]?.shadowRoot?.activeElement, key).toBe(button(items[expected]));
      expect(tabStops().indexOf('0'), key).toBe(expected);
    }
    expect(emitted).toEqual(['b', 'c', 'a', 'c', 'b', 'a', 'c']);
  });

  it('applies the current value to items that arrive later and to value changes', async () => {
    const [first] = await mountGroup(`
      <choice-group name="q3" value="b">
        <choice-item value="a">A</choice-item>
      </choice-group>
    `);
    const group = document.querySelector('choice-group') as ChoiceGroup;
    expect(first?.selected).toBe(false);
    expect(first?.tabbable).toBe(true);

    const late = document.createElement('choice-item') as ChoiceItem;
    late.setAttribute('value', 'b');
    late.textContent = 'B';
    group.appendChild(late);

    await vi.waitFor(() => expect(late.selected).toBe(true));
    expect(late.tabbable).toBe(true);
    expect(first?.tabbable).toBe(false);

    group.value = 'a';
    await group.updateComplete;
    expect(first?.selected).toBe(true);
    expect(late.selected).toBe(false);
  });
});

describe('refine-prompt', () => {
  async function submit(prompt: RefinePrompt, text: string): Promise<void> {
    const textarea = prompt.shadowRoot?.querySelector('textarea');
    const form = prompt.shadowRoot?.querySelector('form');
    if (textarea === null || textarea === undefined || form === null || form === undefined) {
      throw new Error('refine-prompt did not render its form');
    }
    textarea.value = text;
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await prompt.updateComplete;
  }

  it('emits refine with target, prompt, and region, then disables itself', async () => {
    const region = document.createElement('div');
    region.setAttribute('data-htmd-region', '$.msg');
    document.body.appendChild(region);
    const prompt = await mount<RefinePrompt>('refine-prompt', { target: '$.msg.body' }, region);

    const listener = vi.fn();
    document.addEventListener(ComponentEvents.Refine, listener, { once: true });

    await submit(prompt, '  make it shorter ');

    const event = listener.mock.calls[0]?.[0] as CustomEvent<RefineDetail>;
    expect(event.detail).toEqual({
      target: '$.msg.body',
      prompt: 'make it shorter',
      region: '$.msg',
    });
    expect(prompt.shadowRoot?.querySelector('button')?.disabled).toBe(true);
    expect(prompt.shadowRoot?.querySelector('form')?.getAttribute('aria-busy')).toBe('true');
  });

  it('emits nothing and stays enabled when the target is not a region id', async () => {
    const prompt = await mount<RefinePrompt>('refine-prompt', { target: 'answer' });
    const listener = vi.fn();
    document.addEventListener(ComponentEvents.Refine, listener, { once: true });

    await submit(prompt, 'shorter');

    expect(listener).not.toHaveBeenCalled();
    expect(prompt.shadowRoot?.querySelector('button')?.disabled).toBe(false);
  });

  it('re-enables after reset() and can clear the input', async () => {
    const prompt = await mount<RefinePrompt>('refine-prompt', { target: '$.x' });
    await submit(prompt, 'again');
    expect(prompt.shadowRoot?.querySelector('button')?.disabled).toBe(true);

    prompt.reset(true);
    await prompt.updateComplete;

    expect(prompt.shadowRoot?.querySelector('button')?.disabled).toBe(false);
    expect(prompt.shadowRoot?.querySelector('textarea')?.value).toBe('');
  });
});

describe('data-table', () => {
  const authorizeData = { authorizeUrl: () => true };

  function cells(table: DataTable): string[] {
    return [...(table.shadowRoot?.querySelectorAll('td') ?? [])].map(
      (cell) => cell.textContent ?? '',
    );
  }

  function status(table: DataTable): string {
    return table.shadowRoot?.querySelector('[role="status"]')?.textContent ?? '';
  }

  function busy(table: DataTable): string | null | undefined {
    return table.shadowRoot?.querySelector('[aria-busy]')?.getAttribute('aria-busy');
  }

  async function settled(table: DataTable, state: DataTable['loadState']): Promise<void> {
    await vi.waitFor(() => expect(table.loadState).toBe(state));
    await table.updateComplete;
  }

  it('is blocked without a host that authorizes data, even same-origin', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const table = await mount<DataTable>('data-table', { src: '/api/data' });

    expect(table.loadState).toBe('blocked');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(status(table)).not.toBe('');
    expect(status(table)).not.toContain(table.errorText);
  });

  it('fetches an authorized URL as JSON and renders validated rows', async () => {
    const payload = { columns: ['name', 'value'], rows: [{ name: 'a', value: 1 }] };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(payload),
    });
    vi.stubGlobal('fetch', fetchMock);

    const container = hostContainer(authorizeData);
    const table = await mount<DataTable>('data-table', { src: '/api/data' }, container);
    await settled(table, 'loaded');

    expect(fetchMock).toHaveBeenCalledWith(absolute('/api/data'), {
      signal: expect.any(AbortSignal),
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    });
    expect(table.shadowRoot?.querySelectorAll('th')).toHaveLength(2);
    expect(cells(table)).toEqual(['a', '1']);
  });

  it('fails on an invalid payload shape', async () => {
    const loadData = vi.fn().mockResolvedValue({ nope: true });

    const table = await mount<DataTable>(
      'data-table',
      { src: '/api/bad', 'error-text': 'Could not load.' },
      hostContainer({ ...authorizeData, loadData }),
    );
    await settled(table, 'failed');

    expect(status(table)).toBe('Could not load.');
    expect(table.shadowRoot?.querySelector('table')).toBeNull();
  });

  it('renders progressive batches as partial, then loaded', async () => {
    const first = Promise.withResolvers<unknown>();
    const second = Promise.withResolvers<unknown>();
    const loadData = (): AsyncIterable<unknown> =>
      (async function* () {
        yield await first.promise;
        yield await second.promise;
      })();

    const container = hostContainer({ ...authorizeData, loadData });
    const table = await mount<DataTable>('data-table', { src: '/api/rows' }, container);
    expect(table.loadState).toBe('loading');
    expect(busy(table)).toBe('true');

    first.resolve({ columns: ['name'], rows: [{ name: 'a' }] });
    await settled(table, 'partial');
    expect(cells(table)).toEqual(['a']);
    expect(busy(table)).toBe('true');

    second.resolve({ rows: [{ name: 'b' }] });
    await settled(table, 'loaded');
    expect(cells(table)).toEqual(['a', 'b']);
    expect(busy(table)).toBe('false');
  });

  it('keeps received rows and reports interruption when a later batch fails', async () => {
    const loadData = (): AsyncIterable<unknown> =>
      (async function* () {
        yield { columns: ['name'], rows: [{ name: 'a' }] };
        throw new Error('connection reset');
      })();

    const container = hostContainer({ ...authorizeData, loadData });
    const table = await mount<DataTable>('data-table', { src: '/api/rows' }, container);
    await settled(table, 'interrupted');

    expect(cells(table)).toEqual(['a']);
    expect(status(table)).not.toBe('');
  });

  it('aborts the load when src changes and discards its late result', async () => {
    const requests: DataRequest[] = [];
    const responses = new Map<string, PromiseWithResolvers<unknown>>();
    const loadData = (request: DataRequest): Promise<unknown> => {
      requests.push(request);
      const response = Promise.withResolvers<unknown>();
      responses.set(request.url.pathname, response);
      return response.promise;
    };
    const container = hostContainer({ ...authorizeData, loadData });

    const table = await mount<DataTable>('data-table', { src: '/one' }, container);
    table.src = '/two';
    await table.updateComplete;

    expect(requests.map((request) => request.signal.aborted)).toEqual([true, false]);

    const late = responses.get('/one');
    late?.resolve({ columns: ['v'], rows: [{ v: 'one' }] });
    // The table's continuation on this promise was registered first, so it has run by now.
    await late?.promise;
    await table.updateComplete;
    expect(table.loadState).toBe('loading');
    expect(cells(table)).toEqual([]);

    responses.get('/two')?.resolve({ columns: ['v'], rows: [{ v: 'two' }] });
    await settled(table, 'loaded');
    expect(cells(table)).toEqual(['two']);
  });

  it('aborts on disconnect and restarts the load on reconnect', async () => {
    const requests: DataRequest[] = [];
    const loadData = (request: DataRequest): Promise<unknown> => {
      requests.push(request);
      return requests.length === 1
        ? Promise.withResolvers<unknown>().promise
        : Promise.resolve({ columns: ['v'], rows: [{ v: 'x' }] });
    };
    const container = hostContainer({ ...authorizeData, loadData });

    const table = await mount<DataTable>('data-table', { src: '/api/rows' }, container);
    table.remove();
    expect(requests[0]?.signal.aborted).toBe(true);

    container.appendChild(table);
    await settled(table, 'loaded');
    expect(requests).toHaveLength(2);
    expect(cells(table)).toEqual(['x']);
  });

  it(`renders at most ${MAX_TABLE_ROWS} rows and says so`, async () => {
    const rows = Array.from({ length: MAX_TABLE_ROWS + 1 }, (_, index) => ({ n: index }));
    const loadData = vi.fn().mockResolvedValue({ columns: ['n'], rows });

    const container = hostContainer({ ...authorizeData, loadData });
    const table = await mount<DataTable>('data-table', { src: '/api/big' }, container);
    await settled(table, 'loaded');

    expect(table.shadowRoot?.querySelectorAll('tbody tr')).toHaveLength(MAX_TABLE_ROWS);
    expect(status(table)).toContain(String(MAX_TABLE_ROWS));
  });
});
