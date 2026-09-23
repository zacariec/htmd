import {
  baseCatalog,
  createHost,
  defaultHost,
  provideHtmdHost,
  requestHtmdHost,
} from '@htmdjs/contracts';
import type { ContractDiagnostic, HtmdHost } from '@htmdjs/contracts';
import { registerHtmdElements } from '@htmdjs/elements';
import type { ChoiceGroup, ChoiceItem, DataTable, RefinePrompt } from '@htmdjs/elements';
import { Parser } from '@htmdjs/parser';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderMarkdown } from '../src/markdown.js';
import { applySafeAttrs, materializeInto, renderHtmdSource } from '../src/materialize.js';
import { testContract } from './helpers.js';

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
    renderHtmdSource(stage, '<image-card onerror="alert(1)" src="/x.png" alt="x"/>');

    expect(stage.querySelector('image-card')?.getAttribute('onerror')).toBeNull();
  });

  it('keeps plain HTML escaped inside markdown', () => {
    renderHtmdSource(stage, '<div>raw html</div>\n\n<script>alert(1)</script>');

    expect(stage.querySelector('script')).toBeNull();
    expect(stage.textContent).toContain('<script>alert(1)</script>');
  });

  it('renders fallbacks as text projections without instantiating nested components', () => {
    const payload = '{"tag": "div", <image-card src="/x.png" alt="x"/>';
    const result = renderHtmdSource(
      stage,
      [
        '<x-unknown>Intro <image-card src="/x.png" alt="x"/> and',
        '<choice-group name="q"><choice-item value="a">**Pick**</choice-item></choice-group></x-unknown>',
        '',
        '<image-card src="/x.png" alt="x" data-htmd-version="2"/>',
        '',
        `<htmd-fragment>${payload}</htmd-fragment>`,
        '',
        '<script>alert(1)</script>',
      ].join('\n'),
    );

    expect(
      stage.querySelector('x-unknown, image-card, choice-group, choice-item, htmd-fragment'),
    ).toBeNull();
    const unknown = stage.querySelector('[data-htmd-fallback="x-unknown"]');
    expect(unknown?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Intro and Pick');
    expect(unknown?.querySelector('strong')?.textContent).toBe('Pick');
    expect(stage.querySelector('[data-htmd-fallback="image-card"]')?.childNodes).toHaveLength(0);
    expect(stage.querySelector('[data-htmd-fallback="htmd-fragment"] > pre')?.textContent).toBe(
      payload,
    );
    // Parser diagnostics first, then contract diagnostics in document order.
    const codes = result.diagnostics.map((diagnostic) => diagnostic.code);
    expect(new Set(codes.slice(0, -3))).toEqual(new Set(['forbidden-tag']));
    expect(codes.slice(-3)).toEqual([
      'unknown-component',
      'unsupported-component-version',
      'component-rule',
    ]);
  });

  it('provides the host and parses its text components as raw text', () => {
    const host = createHost({
      components: baseCatalog.with(testContract('raw-probe', { children: { kind: 'text' } })),
    });
    const raw = '**a** <image-card src="/x.png" alt="x"/>';
    const result = renderHtmdSource(stage, `<raw-probe>${raw}</raw-probe>`, { host });

    const probe = stage.querySelector('raw-probe');
    if (probe === null) throw new Error('Missing raw probe');
    expect(probe.textContent).toBe(raw);
    expect(probe.children).toHaveLength(0);
    expect(result.diagnostics).toEqual([]);
    expect(requestHtmdHost(probe)).toBe(host);
  });
});

describe('materializeInto', () => {
  function render(
    source: string,
    streaming = true,
    host: HtmdHost = defaultHost,
  ): readonly ContractDiagnostic[] {
    const parsed = Parser.getInstance().parse(source, {
      streaming,
      rawTextTags: host.components.rawTextTags(),
    });
    return materializeInto(stage, parsed.document.nodes, { streaming, host });
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
    const source = '<refine-prompt target="$.answer"/>\n\nWorking';
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
    const host = createHost({ components: baseCatalog, authorizeUrl: () => true });
    provideHtmdHost(stage, host);
    const source = '<data-table src="/api/data"/>';
    render(source, true, host);
    const table = stage.querySelector('data-table') as DataTable;
    await vi.waitFor(async () => {
      await table.updateComplete;
      expect(table.shadowRoot?.querySelector('td')?.textContent).toBe('Retained row');
    });
    const row = table.shadowRoot?.querySelector('tbody tr');

    render(`${source}\n\nMore prose.`, true, host);
    render(`${source}\n\nMore prose.`, false, host);
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

  it('applies initial-owned attributes only at creation and keeps reconciling source-owned ones', () => {
    const choices = '<choice-item value="a">A</choice-item><choice-item value="b">B</choice-item>';
    render(`<choice-group name="q" value="a">${choices}</choice-group>`);
    const group = stage.querySelector('choice-group');
    render(`<choice-group name="question" value="b">${choices}</choice-group>`);

    expect(stage.querySelector('choice-group')).toBe(group);
    expect(group?.getAttribute('name')).toBe('question');
    expect(group?.getAttribute('value')).toBe('a');

    render(`<choice-group name="question">${choices}</choice-group>`, false);
    expect(group?.getAttribute('value')).toBe('a');
  });

  it('defers a streaming choice until its closing tag, then renders it in place', () => {
    const values = (): (string | null)[] =>
      Array.from(stage.querySelectorAll('choice-item'), (item) => item.getAttribute('value'));
    const partial =
      '<choice-group name="q"><choice-item value="a">Alpha</choice-item><choice-item value="b">Be';
    expect(render(partial)).toEqual([]);
    const group = stage.querySelector('choice-group');
    const first = stage.querySelector('choice-item');
    expect(values()).toEqual(['a']);
    expect(stage.textContent).not.toContain('Be');

    render(`${partial}ta</choice-item>`);
    expect(stage.querySelector('choice-group')).toBe(group);
    expect(stage.querySelector('choice-item')).toBe(first);
    expect(values()).toEqual(['a', 'b']);

    const diagnostics = render(partial, false);
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['incomplete-component']);
    expect(values()).toEqual(['a']);
    expect(stage.querySelector('choice-item')).toBe(first);
    expect(group?.querySelector('[data-htmd-fallback="choice-item"]')?.textContent?.trim()).toBe(
      'Be',
    );
  });

  it('never instantiates a registered custom element outside the host catalog', () => {
    let connected = 0;
    customElements.define(
      'catalog-probe',
      class extends HTMLElement {
        connectedCallback(): void {
          connected += 1;
        }
      },
    );

    const diagnostics = render('<catalog-probe>Some **text**</catalog-probe>', false);
    expect(stage.querySelector('catalog-probe')).toBeNull();
    expect(connected).toBe(0);
    expect(stage.querySelector('[data-htmd-fallback="catalog-probe"] strong')?.textContent).toBe(
      'text',
    );
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['unknown-component']);

    const host = createHost({ components: baseCatalog.with(testContract('catalog-probe')) });
    render('<catalog-probe>Some</catalog-probe>', true, host);
    const probe = stage.querySelector('catalog-probe');
    render('<catalog-probe>Some **text**</catalog-probe>\n\nMore', true, host);
    render('<catalog-probe>Some **text**</catalog-probe>\n\nMore', false, host);
    expect(connected).toBe(1);
    expect(stage.querySelector('catalog-probe')).toBe(probe);
    expect(probe?.querySelector('strong')?.textContent).toBe('text');

    stage.replaceChildren();
    render('<catalog-probe>New document</catalog-probe>', true, host);
    expect(connected).toBe(2);
    expect(stage.querySelector('catalog-probe')).not.toBe(probe);
  });

  it('reinterprets provisional nested code on finalization without replacing its parent', () => {
    const host = createHost({
      components: baseCatalog.with(
        testContract('probe-holder'),
        testContract('probe-child', { children: { kind: 'markdown' } }),
      ),
    });
    const source = '<probe-holder>`<probe-child>text</probe-child></probe-holder>';
    render(source, true, host);
    const holder = stage.querySelector('probe-holder');
    expect(holder).not.toBeNull();
    expect(stage.querySelector('probe-child')).toBeNull();
    render(source, false, host);
    expect(stage.querySelector('probe-holder')).toBe(holder);
    expect(stage.querySelector('probe-child')?.textContent).toBe('text');
    const fresh = document.createElement('div');
    renderHtmdSource(fresh, source, { host });
    expect(stage.innerHTML).toBe(fresh.innerHTML);
  });
});
