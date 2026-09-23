import { baseCatalog, baseContracts, createHost } from '@htmdjs/contracts';
import type { HtmdHost } from '@htmdjs/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { KITCHEN_SINK_HTMD } from '../../../examples/playground/src/kitchen-sink-sample.js';
import { renderHtmdSource } from '../src/materialize.js';
import { renderHtmdToString } from '../src/render-to-string.js';

// Elements stay unregistered: parity is about the light DOM the materializer builds.

/** SSR html parsed by the browser must equal what `renderHtmdSource` materializes. */
function expectParity(source: string, host?: HtmdHost): void {
  const options = host === undefined ? {} : { host };
  const ssr = renderHtmdToString(source, options);
  const parsed = document.createElement('div');
  parsed.innerHTML = ssr.html;

  const live = document.createElement('div');
  const dom = renderHtmdSource(live, source, options);

  expect(parsed.innerHTML).toBe(live.innerHTML);
  expect(ssr.diagnostics).toEqual(dom.diagnostics);
}

describe('renderHtmdToString', () => {
  describe('matches renderHtmdSource', () => {
    for (const contract of baseContracts) {
      contract.examples.forEach((example, index) => {
        it(`<${contract.tag}> example ${index + 1}`, () => {
          expectParity(example);
        });
      });
    }

    it('the kitchen-sink document', () => {
      expectParity(KITCHEN_SINK_HTMD);
    });

    it('Markdown with tables, lists, and code', () => {
      expectParity(
        [
          '# Title',
          '',
          '| a | b |',
          '|---|:-:|',
          '| 1 | **2** |',
          '',
          '1. one',
          '2. two',
          '   - nested',
          '- [x] done',
          '',
          '```ts',
          'const x = 1 < 2 && "y";',
          '```',
          '',
          'Inline `code`, <b>raw html</b>, and [link](javascript:alert(1)).',
        ].join('\n'),
      );
    });

    it('an unknown component', () => {
      expectParity('<mystery-box>\n\n**inside** <em>x</em>\n\n</mystery-box>');
    });

    it('a component missing a required attribute', () => {
      expectParity('<image-card alt="no source"></image-card>');
    });

    it('an unsupported data-htmd-version', () => {
      expectParity('<chat-message author="user" data-htmd-version="9">\n\nHi\n\n</chat-message>');
    });

    it('a catalog without the component', () => {
      const host = createHost({ components: baseCatalog.without('chat-message') });
      expectParity('<chat-message author="user">\n\nHi *there*\n\n</chat-message>', host);
    });

    it('raw-text components, rendered and falling back', () => {
      expectParity(
        '<code-block language="html">\n<p class="x">a & b</p>\n</code-block>\n\n' +
          '<htmd-fragment data-htmd-version="9">\n# not *markdown* <b></htmd-fragment>',
      );
    });

    it('text that HTML parsing would otherwise alter', () => {
      expectParity(
        '<code-block language="text">line\r\nnext\rlast</code-block>\n\n' +
          '<htmd-fragment data-htmd-version="9">\n\nleading newlines</htmd-fragment>\n\n' +
          '<image-card src="/a.png?x=1&y=&quot;2&quot;" alt="&quot;q&quot; <tag> & more"></image-card>',
      );
    });

    it('whitespace-only Markdown, including non-breaking spaces', () => {
      expectParity(
        '<image-card src="/x.png" alt="x"></image-card>\n\u00a0\n<unknown-thing>\u00a0\t</unknown-thing>',
      );
    });

    it('disallowed children and nested components', () => {
      expectParity(
        '<choice-group name="pick">\nstray text\n<choice-item value="a">\n\n**A**\n\n</choice-item>\n' +
          '<image-card src="/x.png" alt="x"></image-card>\n</choice-group>',
      );
    });
  });

  describe('without a DOM', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('renders with document, window, and DOM constructors unavailable', () => {
      const expected = renderHtmdToString(KITCHEN_SINK_HTMD);
      for (const name of [
        'document',
        'window',
        'customElements',
        'Node',
        'Element',
        'HTMLElement',
        'HTMLTemplateElement',
        'DOMParser',
      ]) {
        vi.stubGlobal(name, undefined);
      }

      const result = renderHtmdToString(KITCHEN_SINK_HTMD);

      expect(result).toEqual(expected);
      expect(result.html).toContain('<h1>Kitchen sink</h1>');
      expect(result.html).toMatch(/<chat-message author="agent"[^>]*><p>Messages hold/);
    });
  });
});
