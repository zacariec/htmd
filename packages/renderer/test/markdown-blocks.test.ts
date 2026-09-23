import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderMarkdown } from '../src/markdown.js';
import type * as MarkdownModule from '../src/markdown.js';
import { RegionTreeRenderer } from '../src/region-tree-renderer.js';
import { MARKDOWN_CORPUS } from './markdown-corpus.js';

vi.mock('../src/markdown.js', async (importOriginal) => {
  const original = await importOriginal<typeof MarkdownModule>();
  return { ...original, renderMarkdown: vi.fn(original.renderMarkdown) };
});

/**
 * Finished Markdown blocks render once. These tests pin what that must not
 * change (output equals rendering the whole document) and what it buys
 * (finished blocks are left alone; work per chunk does not grow with length).
 */

/** Sources whose partial last line could fool a block-boundary check, plus cross-block features. */
const TRICKY: Readonly<Record<string, string>> = {
  hashtag: 'para one\n#tag continues the paragraph\n\nnext',
  fenceInfo: 'para\n``` a `b` stays paragraph\n\nnext',
  thematic: 'para\n***x is emphasis\n\nnext',
  htmlish: 'para\n<divx is text\n\nnext',
  indent: '10. Tenth item\n    - nested under ten\n11. Eleventh',
  lazy: '> quote line\nlazy continuation\n\n- item\nlazy item line\n\nafter',
  setext: 'Title\n---\n\nbody',
  tableAfterParagraph: 'intro\n| a | b |\n| - | - |\n| 1 | 2 |\n\nafter',
  crlf: 'one\r\n\r\ntwo\r\n- a\r\n- b\r\n\r\nthree',
  looseList: '- a\n\n- b\n\n  continued b\n\nafter',
  referenceLater:
    'See [the docs][d] and [the spec].\n\nMiddle.\n\n[d]: https://example.com/docs\n[the spec]: https://example.com/spec "Spec"\n\nEnd.',
  footnotes: 'A claim.[^1] Another.[^2]\n\n[^1]: First note.\n[^2]: Second note.\n\nAfter.',
  trailingBlankLines: '# Heading\n\ntext\n\n\n',
};

function wholeDocument(source: string): string {
  const template = document.createElement('template');
  template.innerHTML = renderMarkdown(source);
  const host = document.createElement('div');
  host.append(template.content);
  return host.innerHTML;
}

function streamInto(source: string, chunkSize: number) {
  const root = document.createElement('div');
  document.body.append(root);
  const renderer = new RegionTreeRenderer(root);
  let seq = 0;
  const content = () => renderer.regionElement('$.body')?.querySelector('[data-htmd-content]');
  return {
    content,
    send(text: string): void {
      renderer.apply({ type: 'stream', seq: seq++, target: '$.body', chunk: text });
    },
    stream(): void {
      for (let start = 0; start < source.length; start += chunkSize) {
        renderer.apply({
          type: 'stream',
          seq: seq++,
          target: '$.body',
          chunk: source.slice(start, start + chunkSize),
        });
      }
    },
    finish(): void {
      renderer.apply({ type: 'region-done', seq: seq++, id: '$.body' });
    },
  };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.mocked(renderMarkdown).mockClear();
});

describe('incremental Markdown rendering', () => {
  it.each(Object.entries({ ...MARKDOWN_CORPUS, ...TRICKY }))(
    '%s: streamed one character at a time, finalizes to the whole-document render',
    (_, source) => {
      const stream = streamInto(source, 1);
      stream.stream();
      stream.finish();
      expect(stream.content()?.innerHTML).toBe(wholeDocument(source));
    },
  );

  it('never touches a finished block again while later text streams', () => {
    const stream = streamInto('', 1);
    stream.send('First paragraph with **bold** text.\n\n');
    stream.send('Second paragraph starts.\n');
    const first = stream.content()?.querySelector('p');
    if (first === null || first === undefined) throw new Error('missing first paragraph');
    const mutations = new MutationObserver(() => {});
    mutations.observe(first, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });

    for (let index = 0; index < 50; index += 1) {
      stream.send(`- item ${index} with *emphasis*\n`);
    }
    stream.send('\nClosing paragraph.');
    stream.finish();

    expect(mutations.takeRecords()).toEqual([]);
    expect(stream.content()?.querySelector('p')).toBe(first);
    mutations.disconnect();
  });

  it('renders a bounded amount of Markdown per chunk, however long the document grows', () => {
    const block =
      'Revenue grew **12%** in [the quarter](https://example.com/q).\n\n- one\n- two\n\n';
    const lastChunks = 100;
    const perChunk = (repeats: number): number => {
      const source = block.repeat(repeats);
      const split = Math.floor(source.length / 8 - lastChunks) * 8;
      const stream = streamInto('', 8);
      for (let start = 0; start < source.length; start += 8) {
        if (start === split) {
          vi.mocked(renderMarkdown).mockClear();
        }
        stream.send(source.slice(start, start + 8));
      }
      const rendered = vi
        .mocked(renderMarkdown)
        .mock.calls.reduce((total, [markdown]) => total + markdown.length, 0);
      return rendered / lastChunks;
    };
    const short = perChunk(20);
    const long = perChunk(80);
    // Re-rendering everything per chunk would make the long document about 4x costlier.
    expect(long / short).toBeLessThan(1.3);
  });
});
