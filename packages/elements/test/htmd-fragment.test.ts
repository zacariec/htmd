import { baseCatalog, createHost, provideHtmdHost } from '@htmdjs/contracts';
import type { HtmdHostOptions } from '@htmdjs/contracts';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HtmdFragment } from '../src/htmd-fragment.js';
import { setHtmdElementsLogSink } from '../src/internal/logger.js';
import { registerHtmdElements } from '../src/register-htmd-elements.js';

interface FragmentPayload {
  readonly tag: string;
  readonly class?: string;
  readonly text?: string;
  readonly for?: string;
  readonly attrs?: Readonly<Record<string, string>>;
  readonly children?: ReadonlyArray<FragmentPayload>;
}

async function mountFragment(
  payload: FragmentPayload | string,
  state?: Readonly<Record<string, unknown>>,
  parent: Element = document.body,
): Promise<HtmdFragment> {
  const fragment = document.createElement('htmd-fragment') as HtmdFragment;
  fragment.textContent = typeof payload === 'string' ? payload : JSON.stringify(payload);
  if (state !== undefined) {
    fragment.state = state;
  }
  parent.appendChild(fragment);
  await fragment.updateComplete;
  return fragment;
}

/** A container whose descendants are governed by a host built from `options`. */
function hostContainer(options: HtmdHostOptions): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  provideHtmdHost(container, createHost(options));
  return container;
}

function absolute(path: string): string {
  return new URL(path, document.baseURI).href;
}

/**
 * Rendered shadow children, excluding the component's own `<style>` tag
 * (jsdom has no adoptedStyleSheets, so Lit falls back to a style element).
 */
function renderedElements(fragment: HtmdFragment): readonly Element[] {
  return [...(fragment.shadowRoot?.children ?? [])].filter(
    (element) => element.tagName !== 'STYLE',
  );
}

beforeAll(() => {
  registerHtmdElements();
  setHtmdElementsLogSink({ warn: () => {}, error: () => {} });
});

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('htmd-fragment — allowed tags', () => {
  it('renders an allowed tag with its real tag name', async () => {
    const fragment = await mountFragment({ tag: 'h3', text: 'Heading' });

    const heading = fragment.shadowRoot?.querySelector('h3');
    expect(heading).not.toBeNull();
    expect(heading?.textContent).toContain('Heading');
  });

  it('renders nested lists as real ul/li elements', async () => {
    const fragment = await mountFragment({
      tag: 'ul',
      children: [
        { tag: 'li', text: 'one' },
        { tag: 'li', text: 'two' },
      ],
    });

    const items = fragment.shadowRoot?.querySelectorAll('ul > li');
    expect(items).toHaveLength(2);
  });

  it('applies class and safe attributes', async () => {
    const fragment = await mountFragment({
      tag: 'a',
      class: 'link',
      text: 'open',
      attrs: { href: '/docs', target: '_blank' },
    });

    const anchor = fragment.shadowRoot?.querySelector('a');
    expect(anchor?.getAttribute('class')).toBe('link');
    expect(anchor?.getAttribute('href')).toBe(absolute('/docs'));
    expect(anchor?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('renders img with an authorized src and reserved dimensions', async () => {
    const fragment = await mountFragment({
      tag: 'img',
      attrs: { src: '/pic.png', alt: 'pic', width: '400', height: '300' },
    });

    const image = fragment.shadowRoot?.querySelector('img');
    expect(image?.getAttribute('src')).toBe(absolute('/pic.png'));
    expect(image?.getAttribute('width')).toBe('400');
    expect(image?.getAttribute('height')).toBe('300');
  });

  it('renders catalogued components with only their validated attributes', async () => {
    const fragment = await mountFragment({
      tag: 'image-card',
      attrs: { src: '/x.png', alt: 'x', width: '4', onerror: 'alert(1)', style: 'position:fixed' },
    });

    const card = fragment.shadowRoot?.querySelector('image-card');
    expect(card?.getAttribute('src')).toBe('/x.png');
    expect(card?.getAttribute('width')).toBe('4');
    expect(card?.getAttribute('onerror')).toBeNull();
    expect(card?.getAttribute('style')).toBeNull();
  });

  it('passes children only as the component contract accepts', async () => {
    const fragment = await mountFragment({
      tag: 'choice-group',
      attrs: { name: 'next' },
      children: [
        { tag: 'choice-item', attrs: { value: 'a' }, text: 'A' },
        { tag: 'div', text: 'stray' },
      ],
    });

    const group = fragment.shadowRoot?.querySelector('choice-group');
    expect(group?.querySelector('choice-item')?.getAttribute('value')).toBe('a');
    expect(group?.querySelector('div')).toBeNull();
    expect(group?.textContent).not.toContain('stray');
  });

  it('authorizes native image and link URLs with the host by purpose', async () => {
    const container = hostContainer({
      components: baseCatalog,
      authorizeUrl: ({ url, purpose }) => purpose === 'image' && url.hostname === 'cdn.example',
    });
    const fragment = await mountFragment(
      {
        tag: 'div',
        children: [
          { tag: 'img', attrs: { src: 'https://cdn.example/a.png', alt: 'a' } },
          { tag: 'a', text: 'open', attrs: { href: 'https://cdn.example/page' } },
        ],
      },
      undefined,
      container,
    );

    expect(fragment.shadowRoot?.querySelector('img')?.getAttribute('src')).toBe(
      'https://cdn.example/a.png',
    );
    expect(fragment.shadowRoot?.querySelector('a')?.getAttribute('href')).toBeNull();
  });
});

describe('htmd-fragment — rejection paths', () => {
  it('rejects disallowed native tags', async () => {
    for (const tag of ['script', 'style', 'iframe', 'object', 'embed', 'p', 'button']) {
      const fragment = await mountFragment({ tag, text: 'nope' });
      expect(renderedElements(fragment), `expected <${tag}> to be rejected`).toHaveLength(0);
      expect(fragment.shadowRoot?.textContent).not.toContain('nope');
      fragment.remove();
    }
  });

  it('refuses registered custom elements the host catalog does not include', async () => {
    customElements.define('x-widget', class extends HTMLElement {});
    const widget = await mountFragment({ tag: 'x-widget', text: 'nope' });
    expect(widget.shadowRoot?.querySelector('x-widget')).toBeNull();

    const container = hostContainer({ components: baseCatalog.without('image-card') });
    const card = await mountFragment(
      { tag: 'image-card', attrs: { src: '/x.png', alt: 'x' } },
      undefined,
      container,
    );
    expect(card.shadowRoot?.querySelector('image-card')).toBeNull();
  });

  it('drops attributes not on the per-tag allowlist', async () => {
    const fragment = await mountFragment({
      tag: 'div',
      text: 'x',
      attrs: { style: 'position:fixed', id: 'boom' },
    });

    const div = fragment.shadowRoot?.querySelector('div');
    expect(div?.getAttribute('style')).toBeNull();
    expect(div?.getAttribute('id')).toBeNull();
  });

  it('drops javascript: and data: URLs from href/src', async () => {
    const fragment = await mountFragment({
      tag: 'a',
      text: 'x',
      attrs: { href: 'javascript:alert(1)' },
    });
    expect(fragment.shadowRoot?.querySelector('a')?.getAttribute('href')).toBeNull();

    const imageFragment = await mountFragment({
      tag: 'img',
      attrs: { src: 'data:text/html,<script>alert(1)</script>' },
    });
    expect(imageFragment.shadowRoot?.querySelector('img')?.getAttribute('src')).toBeNull();
  });

  it('renders nothing on an invalid payload shape', async () => {
    const fragment = await mountFragment('{"noTag": true}');

    expect(renderedElements(fragment)).toHaveLength(0);
  });
});

describe('htmd-fragment — interpolation', () => {
  it('interpolates flat state keys', async () => {
    const fragment = await mountFragment({ tag: 'h2', text: 'Hello {{name}}' }, { name: 'World' });

    expect(fragment.shadowRoot?.querySelector('h2')?.textContent).toContain('Hello World');
  });

  it('escapes HTML in interpolated values', async () => {
    const fragment = await mountFragment(
      { tag: 'div', text: '{{payload}}' },
      { payload: '<img src=x onerror=alert(1)>' },
    );

    expect(fragment.shadowRoot?.querySelector('img')).toBeNull();
    expect(fragment.shadowRoot?.querySelector('div')?.textContent).toContain(
      '<img src=x onerror=alert(1)>',
    );
  });

  it('renders missing keys as empty strings', async () => {
    const fragment = await mountFragment({ tag: 'span', text: 'v={{missing}}!' }, {});

    expect(fragment.shadowRoot?.querySelector('span')?.textContent).toContain('v=!');
  });
});

describe('htmd-fragment — for loops', () => {
  it('renders one node per list item', async () => {
    const fragment = await mountFragment(
      {
        tag: 'ul',
        children: [{ tag: 'li', for: 'item in items', text: '{{item}}' }],
      },
      { items: ['a', 'b', 'c'] },
    );

    const items = fragment.shadowRoot?.querySelectorAll('li');
    expect(items).toHaveLength(3);
    expect(items?.[2]?.textContent).toContain('c');
  });

  it('bounds loops at 1000 items', async () => {
    const bigList = Array.from({ length: 1500 }, (_, index) => `row-${index}`);
    const fragment = await mountFragment(
      { tag: 'ul', children: [{ tag: 'li', for: 'item in bigList', text: '{{item}}' }] },
      { bigList },
    );

    expect(fragment.shadowRoot?.querySelectorAll('li')).toHaveLength(1000);
  });

  it('renders nothing for a non-array loop source', async () => {
    const fragment = await mountFragment(
      { tag: 'ul', children: [{ tag: 'li', for: 'item in items', text: '{{item}}' }] },
      { items: 'not-a-list' },
    );

    expect(fragment.shadowRoot?.querySelectorAll('li')).toHaveLength(0);
  });
});

describe('htmd-fragment — streaming payloads', () => {
  it('re-parses the payload when the light DOM text changes', async () => {
    const fragment = await mountFragment({ tag: 'h2', text: 'first' });
    expect(fragment.shadowRoot?.querySelector('h2')?.textContent).toContain('first');

    fragment.textContent = JSON.stringify({ tag: 'h3', text: 'second' });
    await vi.waitFor(async () => {
      await fragment.updateComplete;
      expect(fragment.shadowRoot?.querySelector('h3')?.textContent).toContain('second');
    });
  });

  it('stays empty while the payload JSON is incomplete', async () => {
    const fragment = await mountFragment('{"tag": "h2", "text": "par');

    expect(renderedElements(fragment)).toHaveLength(0);
  });
});
