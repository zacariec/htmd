import { afterEach, describe, expect, it } from 'vitest';

import { renderHtmdSource } from '../src/materialize.js';
import { RegionTreeRenderer } from '../src/region-tree-renderer.js';
import { MARKDOWN_CORPUS } from './markdown-corpus.js';

/**
 * Streaming Markdown properties, checked at every character boundary:
 *
 * - No syntax flashes: the visible text of any prefix is a prefix of the
 *   final visible text. Unfinished delimiters, link syntax, table pipes, and
 *   ambiguous line markers never appear only to disappear later.
 * - No retraction: visible text only grows from one chunk to the next.
 * - No premature links: every link or image shown mid-stream has the exact
 *   destination it has in the final document.
 */

const visible = (element: Element): string =>
  (element.textContent ?? '').replace(/\s+/g, ' ').trim();

function destinations(element: Element): Set<string> {
  return new Set(
    [...element.querySelectorAll('a[href], img[src]')].map(
      (node) => node.getAttribute('href') ?? node.getAttribute('src') ?? '',
    ),
  );
}

interface StreamReport {
  readonly flashes: readonly string[];
  readonly retractions: readonly string[];
  readonly premature: readonly string[];
}

function streamCharacters(source: string): StreamReport {
  const reference = document.createElement('div');
  document.body.append(reference);
  renderHtmdSource(reference, source);
  const finalText = visible(reference);
  const finalDestinations = destinations(reference);

  const root = document.createElement('div');
  document.body.append(root);
  const renderer = new RegionTreeRenderer(root);
  const flashes: string[] = [];
  const retractions: string[] = [];
  const premature: string[] = [];
  let shown = '';
  for (let end = 1; end <= source.length; end += 1) {
    renderer.apply({ type: 'stream', seq: end, target: '$.body', chunk: source[end - 1] ?? '' });
    const content = renderer.regionElement('$.body')?.querySelector('[data-htmd-content]');
    if (content === null || content === undefined) {
      continue;
    }
    const text = visible(content);
    const at = JSON.stringify(source.slice(0, end).slice(-24));
    if (!finalText.startsWith(text)) {
      flashes.push(`${at} shows ${JSON.stringify(text.slice(-24))}`);
    }
    if (!text.startsWith(shown)) {
      retractions.push(`${at} retracts ${JSON.stringify(shown.slice(-24))}`);
    }
    shown = text;
    for (const destination of destinations(content)) {
      if (!finalDestinations.has(destination)) {
        premature.push(`${at} links ${destination}`);
      }
    }
  }
  renderer.apply({ type: 'region-done', seq: source.length + 1, id: '$.body' });
  expect(renderer.regionElement('$.body')?.querySelector('[data-htmd-content]')?.innerHTML).toBe(
    reference.innerHTML,
  );
  return { flashes, retractions, premature };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('streaming Markdown', () => {
  it.each(Object.entries(MARKDOWN_CORPUS))(
    '%s: never flashes syntax, retracts text, or links prematurely',
    (_, source) => {
      const report = streamCharacters(source);
      expect.soft(report.flashes.length, report.flashes.slice(0, 6).join('\n')).toBe(0);
      expect.soft(report.retractions.length, report.retractions.slice(0, 6).join('\n')).toBe(0);
      expect.soft(report.premature.length, report.premature.slice(0, 6).join('\n')).toBe(0);
    },
  );
});
