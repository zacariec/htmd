import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Reads a JSONL fixture into an array of raw (unvalidated) event objects. */
export function loadFixture(name: string): readonly unknown[] {
  const raw = readFileSync(resolve(process.cwd(), 'test/fixtures', name), 'utf8');
  return raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as unknown);
}
