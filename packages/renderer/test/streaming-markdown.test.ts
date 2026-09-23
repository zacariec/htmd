import { describe, expect, it } from 'vitest';

import { renderMarkdown } from '../src/markdown.js';
import { provisionalMarkdown } from '../src/streaming-markdown.js';

/**
 * Liveness: the corpus properties (markdown-streaming.test.ts) prove nothing
 * flashes or retracts, which withholding everything would also satisfy. These
 * cases prove content appears as soon as it is unambiguous.
 */
const html = (source: string): string => renderMarkdown(provisionalMarkdown(source).source).trim();

describe('provisionalMarkdown shows unambiguous content immediately', () => {
  it.each([
    ['open strong', 'Revenue grew **12', '<p>Revenue grew <strong>12</strong></p>'],
    ['partial strong closer', '**Hello*', '<p><strong>Hello</strong></p>'],
    ['nested emphasis', 'a ***b', '<p>a <em><strong>b</strong></em></p>'],
    ['strikethrough', 'was ~~old', '<p>was <del>old</del></p>'],
    ['underscore strong', '__init', '<p><strong>init</strong></p>'],
    ['inline code', 'run `pnpm te', '<p>run <code>pnpm te</code></p>'],
    ['partial code closer', 'use ``a ` b`', '<p>use <code>a ` b</code></p>'],
    ['emphasis around code', '**see `co', '<p><strong>see <code>co</code></strong></p>'],
    ['link label once its destination starts', 'See [docs](https://exa', '<p>See docs</p>'],
    ['bare URL as text', 'go to https://example.co', '<p>go to https://example.co</p>'],
    ['email as text', 'mail ops@example.co', '<p>mail ops@example.co</p>'],
    ['list item text', '1. Build the **Q1', '<ol>\n<li>Build the <strong>Q1</strong></li>\n</ol>'],
    ['confirmed table row', '| a | b |\n| - | - |\n| **x', '<table>'],
    [
      'unclosed code fence',
      '```ts\nconst x',
      '<pre><code class="language-ts">const x\n</code></pre>',
    ],
  ])('%s', (_, source, expected) => {
    expect(html(source).startsWith(expected), html(source)).toBe(true);
  });
});

describe('provisionalMarkdown withholds only what is ambiguous', () => {
  it.each([
    ['intraword asterisk stays literal', 'so x = 2*3', 'so x = 2*3'],
    ['snake_case stays literal', 'a snake_ca', 'a snake_ca'],
    ['trailing delimiter run', 'Revenue grew **', 'Revenue grew '],
    ['marker-only line', 'Steps:\n1', 'Steps:\n'],
    ['task marker', '- [x', ''],
    ['unresolved bracket (link or citation)', 'As shown in [1', 'As shown in '],
    ['closed label awaiting destination', 'See [docs]', 'See '],
    ['partial image', 'Chart: ![weekly](https://exa', 'Chart: '],
    ['partial angle autolink', 'or <https://exa', 'or '],
    ['table header before its delimiter row', 'Intro\n\n| a | b |\n| -', 'Intro\n\n'],
    ['partial closing fence', '```\ncode\n``', '```\ncode\n'],
  ])('%s', (_, source, expected) => {
    expect(provisionalMarkdown(source).source).toBe(expected);
  });

  it('leaves complete sources untouched and reports whether it changed anything', () => {
    const complete = 'Done **now**. See [docs](https://example.com).\n';
    expect(provisionalMarkdown(complete)).toEqual({ source: complete, provisional: false });
    expect(provisionalMarkdown('Done **no').provisional).toBe(true);
  });
});
