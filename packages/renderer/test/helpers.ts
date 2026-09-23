import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { ComponentContract } from '@htmdjs/contracts';

/** Reads a JSONL fixture into an array of raw (unvalidated) event objects. */
export function loadFixture(name: string): readonly unknown[] {
  const raw = readFileSync(resolve(process.cwd(), 'test/fixtures', name), 'utf8');
  return raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as unknown);
}

/** A minimal valid contract for a test-only component: flow children, no attributes. */
export function testContract(
  tag: string,
  overrides: Partial<ComponentContract> = {},
): ComponentContract {
  return {
    tag,
    version: 1,
    description: `Test component <${tag}>.`,
    attributes: {},
    children: { kind: 'flow' },
    partial: 'progressive',
    partialBehavior: 'Renders as it streams.',
    state: 'No user-owned state.',
    events: [],
    effects: [],
    accessibility: 'Not applicable.',
    examples: [`<${tag}></${tag}>`],
    ...overrides,
  };
}
