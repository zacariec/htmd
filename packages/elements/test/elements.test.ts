import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChoiceGroup } from '../src/choice-group.js';
import type { ChoiceItem } from '../src/choice-item.js';
import type { DataTable } from '../src/data-table.js';
import { HtmdElementEvents } from '../src/events.js';
import type { ChoiceDetail, RefineDetail } from '../src/events.js';
import type { FilePreview } from '../src/file-preview.js';
import type { ImageCard } from '../src/image-card.js';
import { setHtmdElementsLogSink } from '../src/internal/logger.js';
import type { RefinePrompt } from '../src/refine-prompt.js';
import { registerHtmdElements } from '../src/register-htmd-elements.js';

async function mount<T extends HTMLElement>(
  tag: string,
  attrs: Record<string, string>,
): Promise<T> {
  const element = document.createElement(tag) as T;
  for (const [name, value] of Object.entries(attrs)) {
    element.setAttribute(name, value);
  }
  document.body.appendChild(element);
  await (element as unknown as { updateComplete: Promise<boolean> }).updateComplete;
  return element;
}

beforeAll(() => {
  registerHtmdElements();
  setHtmdElementsLogSink({ warn: () => {}, error: () => {} });
});

beforeEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
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

describe('file-preview', () => {
  it('renders a download link for a safe href', async () => {
    const preview = await mount<FilePreview>('file-preview', {
      name: 'report.pdf',
      mime: 'application/pdf',
      'size-bytes': '2048',
      href: '/files/report.pdf',
    });

    const anchor = preview.shadowRoot?.querySelector('a');
    expect(anchor?.getAttribute('href')).toBe('/files/report.pdf');
  });

  it('renders no link for a javascript: href', async () => {
    const preview = await mount<FilePreview>('file-preview', {
      name: 'x',
      mime: 'text/plain',
      href: 'javascript:alert(1)',
    });

    expect(preview.shadowRoot?.querySelector('a')).toBeNull();
  });
});

describe('image-card', () => {
  it('renders a sanitized src', async () => {
    const card = await mount<ImageCard>('image-card', {
      src: 'https://example.com/x.png',
      alt: 'x',
      width: '4',
      height: '3',
    });

    expect(card.shadowRoot?.querySelector('img')?.getAttribute('src')).toBe(
      'https://example.com/x.png',
    );
  });

  it('drops a data: src', async () => {
    const card = await mount<ImageCard>('image-card', {
      src: 'data:image/png;base64,AAAA',
      alt: 'x',
    });

    expect(card.shadowRoot?.querySelector('img')?.getAttribute('src')).toBeNull();
  });
});

describe('choice-group', () => {
  it('emits a choice event and syncs selection', async () => {
    document.body.innerHTML = `
      <choice-group name="q1">
        <choice-item value="a">A</choice-item>
        <choice-item value="b">B</choice-item>
      </choice-group>
    `;
    const group = document.querySelector('choice-group') as ChoiceGroup;
    const items = [...document.querySelectorAll('choice-item')] as ChoiceItem[];
    await group.updateComplete;
    await Promise.all(items.map((item) => item.updateComplete));

    const listener = vi.fn();
    document.addEventListener(HtmdElementEvents.Choice, listener as EventListener, { once: true });

    items[1]?.shadowRoot?.querySelector('button')?.click();
    await group.updateComplete;

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0]?.[0] as CustomEvent<ChoiceDetail>;
    expect(event.detail).toEqual({ name: 'q1', value: 'b' });
    expect(items[1]?.selected).toBe(true);
    expect(items[0]?.selected).toBe(false);
    expect(group.value).toBe('b');
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

  it('emits refine with target and prompt, then disables itself', async () => {
    const prompt = await mount<RefinePrompt>('refine-prompt', { target: '$.msg.body' });

    const listener = vi.fn();
    document.addEventListener(HtmdElementEvents.Refine, listener as EventListener, { once: true });

    await submit(prompt, 'make it shorter');

    const event = listener.mock.calls[0]?.[0] as CustomEvent<RefineDetail>;
    expect(event.detail).toEqual({ target: '$.msg.body', prompt: 'make it shorter' });
    expect(prompt.shadowRoot?.querySelector('button')?.disabled).toBe(true);
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
  it('fetches, validates, and renders same-origin data', async () => {
    const payload = { columns: ['name', 'value'], rows: [{ name: 'a', value: 1 }] };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(payload),
    });
    vi.stubGlobal('fetch', fetchMock);

    const table = await mount<DataTable>('data-table', { src: '/api/data' });
    await vi.waitFor(async () => {
      await table.updateComplete;
      expect(table.shadowRoot?.querySelector('table')).not.toBeNull();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(table.shadowRoot?.querySelectorAll('th')).toHaveLength(2);
    expect(table.shadowRoot?.querySelector('td')?.textContent).toContain('a');
  });

  it('blocks cross-origin fetches by default', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const table = await mount<DataTable>('data-table', { src: 'https://evil.example/api' });
    await vi.waitFor(async () => {
      await table.updateComplete;
      expect(table.shadowRoot?.querySelector('.error')).not.toBeNull();
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the error state on an invalid payload shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ nope: true }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const table = await mount<DataTable>('data-table', { src: '/api/bad' });
    await vi.waitFor(async () => {
      await table.updateComplete;
      expect(table.shadowRoot?.querySelector('.error')).not.toBeNull();
    });
  });

  it('re-fetches when src changes', async () => {
    const payload = { columns: ['c'], rows: [] };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(payload),
    });
    vi.stubGlobal('fetch', fetchMock);

    const table = await mount<DataTable>('data-table', { src: '/api/one' });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    table.src = '/api/two';
    await table.updateComplete;
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
