import { Parser } from '@htmdjs/parser';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { baseCatalog } from '../src/base.js';
import type { ComponentCatalog } from '../src/catalog.js';
import { modelInstructions } from '../src/model-instructions.js';
import { validateNodes } from '../src/resolve.js';
import type { ComponentContract } from '../src/types.js';

const statusBadge: ComponentContract = {
  tag: 'status-badge',
  version: 1,
  description: 'A short status label for a deployment.',
  attributes: {
    level: {
      description: 'one of "ok", "warn", or "down"',
      schema: z.enum(['ok', 'warn', 'down']),
      required: true,
      ownership: 'source',
    },
    note: { description: 'tooltip text', schema: z.string(), ownership: 'source' },
  },
  children: { kind: 'markdown' },
  partial: 'progressive',
  partialBehavior: 'Label renders as it streams.',
  state: 'No user-owned state.',
  events: [],
  effects: [],
  accessibility: 'status role.',
  examples: ['<status-badge level="warn">Degraded</status-badge>'],
};

/** Bodies of every fenced code block, honouring variable fence lengths. */
function fencedBlocks(markdown: string): string[] {
  return [...markdown.matchAll(/^(`{3,})[^\n]*\n([\s\S]*?)\n\1$/gm)].map((match) => match[2] ?? '');
}

describe('modelInstructions', () => {
  it('never mentions components withheld from the catalog', () => {
    const text = modelInstructions(baseCatalog.without('data-table'));
    expect(text).not.toContain('data-table');
    expect(text).toContain('`<image-card>`');
  });

  it('marks required attributes and only those', () => {
    const text = modelInstructions(baseCatalog);
    expect(text).toContain('- `src` (required): image URL');
    expect(text).toContain('- `alt` (required): alternative text');
    expect(text).toContain('- `caption`: caption');
  });

  it('describes a contract added to the catalog', () => {
    const text = modelInstructions(baseCatalog.with(statusBadge));
    expect(text).toContain('### `<status-badge>`');
    expect(text).toContain('- `level` (required): one of "ok", "warn", or "down"');
    expect(text).toContain(statusBadge.examples[0]);
  });

  it('never advertises withheld components through children or examples', () => {
    const text = modelInstructions(baseCatalog.without('choice-item'));
    expect(text).toContain('### `<choice-group>`');
    expect(text).not.toContain('choice-item');
  });

  it('prints every example so that it parses and validates cleanly', () => {
    const full: ComponentCatalog[] = [baseCatalog, baseCatalog.with(statusBadge)];
    const narrowed = baseCatalog.without('choice-group', 'code-block');
    for (const catalog of [...full, narrowed]) {
      const blocks = fencedBlocks(modelInstructions(catalog));
      const examples = catalog.contracts().flatMap((contract) => contract.examples);
      if (full.includes(catalog)) {
        expect(blocks).toEqual(examples);
      }
      for (const block of blocks) {
        expect(examples).toContain(block);
        const parsed = Parser.getInstance().parse(block, { rawTextTags: catalog.rawTextTags() });
        expect(parsed.diagnostics, block).toEqual([]);
        expect(validateNodes(parsed.document.nodes, catalog), block).toEqual([]);
      }
    }
  });

  it('omits examples on request', () => {
    expect(fencedBlocks(modelInstructions(baseCatalog, { examples: false }))).toEqual([]);
  });

  it('tells the model to write Markdown only when no components are available', () => {
    const text = modelInstructions(baseCatalog.without(...baseCatalog.tags()));
    expect(text).toContain('Markdown only');
    expect(text).not.toMatch(/<[a-z]+-[a-z]+/);
  });
});
