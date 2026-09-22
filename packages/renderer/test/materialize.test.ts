import { registerHtmdElements } from '@zacariec/htmd-elements';
import type { ChoiceGroup, ChoiceItem, DataTable, RefinePrompt } from '@zacariec/htmd-elements';
import { Parser } from '@zacariec/htmd-parser';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderMarkdown } from '../src/markdown.js';
import { applySafeAttrs, materializeInto, renderHtmdSource } from '../src/materialize.js';

let stage: HTMLDivElement;

beforeAll(() => {
  registerHtmdElements();
});

beforeEach(() => {
  document.body.innerHTML = '';
  stage = document.createElement('div');
  document.body.appendChild(stage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('renderMarkdown', () => {
  it('renders GFM markdown', () => {
    const html = renderMarkdown('# Title\n\nSome **bold** and ~~gone~~.');

    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<del>gone</del>');
  });

  it('escapes raw HTML', () => {
    const html = renderMarkdown('hello <script>alert(1)</script>');

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('strips dangerous link protocols', () => {
    const html = renderMarkdown('[x](javascript:alert(1))');

    expect(html).not.toContain('href="javascript:');
  });
});

describe('renderHtmdSource', () => {
  it('renders markdown blocks as HTML', () => {
    renderHtmdSource(stage, '# Hello\n\nSome *prose*.');

    expect(stage.querySelector('h1')?.textContent).toBe('Hello');
    expect(stage.querySelector('em')?.textContent).toBe('prose');
  });

  it('materializes custom elements with attributes', () => {
    renderHtmdSource(stage, 'Before.\n\n<image-card src="/x.png" alt="x" width="4" height="3"/>');

    const card = stage.querySelector('image-card');
    expect(card).not.toBeNull();
    expect(card?.getAttribute('src')).toBe('/x.png');
    expect(card?.getAttribute('width')).toBe('4');
  });

  it('materializes entity-carrying attributes as the characters they encode', () => {
    renderHtmdSource(stage, '<image-card src="/x.png" alt="Milk &amp; Honey &#38; Oats"/>');

    expect(stage.querySelector('image-card')?.getAttribute('alt')).toBe('Milk & Honey & Oats');
  });

  it('nests children inside paired elements', () => {
    renderHtmdSource(
      stage,
      '<choice-group name="q"><choice-item value="a">A</choice-item></choice-group>',
    );

    const item = stage.querySelector('choice-group > choice-item');
    expect(item?.getAttribute('value')).toBe('a');
    expect(item?.textContent).toContain('A');
  });

  it('keeps fragment payloads as raw text', () => {
    const payload = '{"tag":"div","text":"hi"}';
    renderHtmdSource(stage, `<htmd-fragment kind="card">${payload}</htmd-fragment>`);

    const fragment = stage.querySelector('htmd-fragment');
    expect(fragment?.textContent).toBe(payload);
    expect(fragment?.querySelector('div')).toBeNull();
  });

  it('never sets on* attributes', () => {
    renderHtmdSource(stage, '<image-card onerror="alert(1)" src="/x.png"/>');

    expect(stage.querySelector('image-card')?.getAttribute('onerror')).toBeNull();
  });

  it('keeps plain HTML escaped inside markdown', () => {
    renderHtmdSource(stage, '<div>raw html</div>\n\n<script>alert(1)</script>');

    expect(stage.querySelector('script')).toBeNull();
    expect(stage.textContent).toContain('<script>alert(1)</script>');
  });
});

describe('materializeInto', () => {
  function render(source: string, streaming = true): void {
    const parsed = Parser.getInstance().parse(source, { streaming });
    materializeInto(stage, parsed.document.nodes, { streaming });
  }

  it('retains selected choices, shadow DOM, and siblings while prose grows and finalizes', async () => {
    const source =
      '# Heading\n\n<choice-group name="q" value="a">' +
      '<choice-item value="a">A</choice-item>' +
      '<choice-item value="b">B</choice-item></choice-group>\n\nMore';
    render(source);
    const heading = stage.querySelector('h1');
    const paragraph = stage.querySelector('choice-group + p');
    const group = stage.querySelector('choice-group') as ChoiceGroup;
    const items = Array.from(group.querySelectorAll('choice-item')) as ChoiceItem[];
    await group.updateComplete;
    await Promise.all(items.map((item) => item.updateComplete));
    const button = items[1]?.shadowRoot?.querySelector('button');
    if (!button) throw new Error('Missing choice button');
    button.click();
    await group.updateComplete;
    await Promise.all(items.map((item) => item.updateComplete));
    expect(button.getAttribute('aria-checked')).toBe('true');

    const mutations = new MutationObserver(() => {});
    mutations.observe(group, {
      attributes: true,
      childList: true,
      subtree: true,
      characterData: true,
    });
    render(`${source} prose.\n\n- Next`);
    render(`${source} prose.\n\n- Next`, false);

    expect(stage.querySelector('h1')).toBe(heading);
    expect(stage.querySelector('choice-group + p')).toBe(paragraph);
    expect(paragraph?.textContent).toBe('More prose.');
    expect(stage.querySelector('choice-group')).toBe(group);
    expect(group.querySelectorAll('choice-item')[1]).toBe(items[1]);
    expect(items[1]?.shadowRoot?.querySelector('button')).toBe(button);
    expect(group.value).toBe('b');
    expect(group.getAttribute('value')).toBe('b');
    expect(items[1]?.hasAttribute('selected')).toBe(true);
    expect(mutations.takeRecords()).toEqual([]);
    mutations.disconnect();

    // Changing one source attribute must not reassert other, unchanged ones
    // over values reflected by the live component.
    render(source.replace('name="q"', 'name="question"'));
    await group.updateComplete;
    expect(group.name).toBe('question');
    expect(group.value).toBe('b');
    expect(items[1]?.selected).toBe(true);
  });

  it('preserves focused refine text and selection through streaming and finalization', async () => {
    const source = '<refine-prompt target="answer"/>\n\nWorking';
    render(source);
    const prompt = stage.querySelector('refine-prompt') as RefinePrompt;
    await prompt.updateComplete;
    const textarea = prompt.shadowRoot?.querySelector('textarea');
    if (!textarea) throw new Error('Missing refinement textarea');
    textarea.value = 'Keep this draft';
    textarea.focus();
    textarea.setSelectionRange(5, 9);

    render(`${source} on the answer.`);
    render(`${source} on the answer.`, false);

    expect(stage.querySelector('refine-prompt')).toBe(prompt);
    expect(prompt.shadowRoot?.querySelector('textarea')).toBe(textarea);
    expect(textarea.value).toBe('Keep this draft');
    expect(document.activeElement).toBe(prompt);
    expect(prompt.shadowRoot?.activeElement).toBe(textarea);
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([5, 9]);
  });

  it('keeps loaded data tables without restarting their fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ columns: ['name'], rows: [{ name: 'Retained row' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const source = '<data-table src="/api/data"/>';
    render(source);
    const table = stage.querySelector('data-table') as DataTable;
    await vi.waitFor(async () => {
      await table.updateComplete;
      expect(table.shadowRoot?.querySelector('td')?.textContent).toBe('Retained row');
    });
    const row = table.shadowRoot?.querySelector('tbody tr');

    render(`${source}\n\nMore prose.`);
    render(`${source}\n\nMore prose.`, false);
    await table.updateComplete;

    expect(stage.querySelector('data-table')).toBe(table);
    expect(table.shadowRoot?.querySelector('tbody tr')).toBe(row);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('updates and removes changed source attributes without removing runtime attributes', () => {
    render('<image-card src="/one.png" alt="Before" width="4"/>');
    const card = stage.querySelector('image-card');
    if (!card) throw new Error('Missing image card');
    card.setAttribute('data-runtime', 'retained');
    render('<image-card src="/two.png" alt="After" onclick="alert(1)"/>');

    expect(stage.querySelector('image-card')).toBe(card);
    expect(card.getAttribute('src')).toBe('/two.png');
    expect(card.getAttribute('alt')).toBe('After');
    expect(card.hasAttribute('width')).toBe(false);
    expect(card.getAttribute('data-runtime')).toBe('retained');
    expect(card.hasAttribute('onclick')).toBe(false);

    applySafeAttrs(card, { OnClick: 'alert(2)' });
    expect(card.hasAttribute('onclick')).toBe(false);
  });

  it('reconciles Markdown structure and removals to the same output as a fresh static render', () => {
    render('# Heading\n\nParagraph');
    const heading = stage.querySelector('h1');
    const paragraph = stage.querySelector('p');
    const source = '# Heading\n\nParagraph with **bold**.\n\n- One\n- Two';
    render(source, false);
    const fresh = document.createElement('div');
    renderHtmdSource(fresh, source);

    expect(stage.innerHTML).toBe(fresh.innerHTML);
    expect(stage.querySelector('h1')).toBe(heading);
    expect(stage.querySelector('p')).toBe(paragraph);

    render('# Replacement', false);
    expect(stage.innerHTML).toBe('<h1>Replacement</h1>');
    render('', false);
    expect(stage.childNodes).toHaveLength(0);
  });

  it('preserves raw fragment text without interpreting Markdown or HTML', () => {
    const payload = '{"tag":"div","text":"**raw** <img src=x onerror=alert(1)>"}';
    const source = `<htmd-fragment>${payload}</htmd-fragment>`;
    render(source);
    const fragment = stage.querySelector('htmd-fragment');
    if (!fragment) throw new Error('Missing fragment');
    const text = fragment.firstChild;
    render(`${source}\n\nFollowing prose.`);

    expect(stage.querySelector('htmd-fragment')).toBe(fragment);
    expect(fragment.firstChild).toBe(text);
    expect(fragment.textContent).toBe(payload);
    expect(fragment.querySelector('img')).toBeNull();
    expect(fragment.querySelector('strong')).toBeNull();
  });

  it('reinterprets provisional nested code on finalization without replacing its parent', () => {
    const source = '<probe-holder>`<probe-child>text</probe-child></probe-holder>';
    render(source);
    const holder = stage.querySelector('probe-holder');
    expect(stage.querySelector('probe-child')).toBeNull();
    render(source, false);
    expect(stage.querySelector('probe-holder')).toBe(holder);
    expect(stage.querySelector('probe-child')?.textContent).toBe('text');
    const fresh = document.createElement('div');
    renderHtmdSource(fresh, source);
    expect(stage.innerHTML).toBe(fresh.innerHTML);
  });

  it('constructs only live custom elements and resets after explicit container clearing', () => {
    let constructed = 0;
    customElements.define(
      'materialize-probe',
      class extends HTMLElement {
        constructor() {
          super();
          constructed += 1;
        }
      },
    );
    render('<materialize-probe/>');
    const first = stage.firstElementChild;
    render('<materialize-probe/>\n\nOne');
    render('<materialize-probe/>\n\nOne more', false);
    expect(constructed).toBe(1);
    expect(stage.firstElementChild).toBe(first);

    stage.replaceChildren();
    render('<materialize-probe/>\n\nNew document');
    expect(constructed).toBe(2);
    expect(stage.firstElementChild).not.toBe(first);
  });
});
