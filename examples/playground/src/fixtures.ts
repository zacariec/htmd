import type { WireEvent } from '@htmdjs/wire';
import fixture01 from '../../../packages/renderer/test/fixtures/01-single-message.jsonl?raw';
import fixture02 from '../../../packages/renderer/test/fixtures/02-ordered-fill.jsonl?raw';
import fixture03 from '../../../packages/renderer/test/fixtures/03-out-of-order.jsonl?raw';
import fixture04 from '../../../packages/renderer/test/fixtures/04-region-replace.jsonl?raw';
import fixture05 from '../../../packages/renderer/test/fixtures/05-nested.jsonl?raw';
import fixture06 from '../../../packages/renderer/test/fixtures/06-refine-loop.jsonl?raw';
import fixture07 from '../../../packages/renderer/test/fixtures/07-choice-selection.jsonl?raw';
import fixture08 from '../../../packages/renderer/test/fixtures/08-resume.jsonl?raw';
import fixture09 from '../../../packages/renderer/test/fixtures/09-complex-real-world.jsonl?raw';
import fixture10 from '../../../packages/renderer/test/fixtures/10-all-elements.jsonl?raw';

export interface WireFixture {
  readonly id: string;
  readonly label: string;
  readonly events: readonly WireEvent[];
}

function parse(id: string, label: string, raw: string): WireFixture {
  const events = raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as WireEvent);
  return { id, label, events };
}

export const WIRE_FIXTURES: readonly WireFixture[] = [
  parse('01-single-message', '01 · single message', fixture01),
  parse('02-ordered-fill', '02 · ordered fill', fixture02),
  parse('03-out-of-order', '03 · out-of-order fill', fixture03),
  parse('04-region-replace', '04 · region replace', fixture04),
  parse('05-nested', '05 · nested fragment', fixture05),
  parse('06-refine-loop', '06 · refine loop', fixture06),
  parse('07-choice-selection', '07 · choice selection', fixture07),
  parse('08-resume', '08 · resume after drop', fixture08),
  parse('09-complex-real-world', '09 · complex real-world', fixture09),
  parse('10-all-elements', '10 · every element', fixture10),
  {
    id: '11-live-interaction',
    label: '11 · partial syntax and preserved interaction',
    events: [
      { type: 'doc-open', seq: 0, id: 'live-demo', schemaVersion: '0.1' },
      { type: 'region', seq: 1, id: '$.answer', tag: 'section' },
      {
        type: 'stream',
        seq: 2,
        target: '$.answer',
        chunk:
          '# Interact while the answer streams\n\n<choice-group name="next"><choice-item value="explore">Explore</choice-item><choice-item value="export">Export</choice-item></choice-group>\n\n<refine-prompt target="$.answer"></refine-prompt>\n\n',
      },
      {
        type: 'stream',
        seq: 3,
        target: '$.answer',
        chunk:
          'Choose an option and type a draft above. Both survive the next chunks.\n\n<file-pre',
      },
      {
        type: 'stream',
        seq: 4,
        target: '$.answer',
        chunk: 'view name="report.txt" mime="text/plain"/>',
      },
      {
        type: 'stream',
        seq: 5,
        target: '$.answer',
        chunk: '\n\n## Details\n\nStreaming **keeps your choices',
      },
      {
        type: 'stream',
        seq: 6,
        target: '$.answer',
        chunk:
          '** and draft text.\n\n```html\n<choice-group name="literal">This stays code.</choice-group>\n',
      },
      {
        type: 'stream',
        seq: 7,
        target: '$.answer',
        chunk: '```\n\nThe finished document uses normal Markdown semantics.',
      },
      { type: 'region-done', seq: 8, id: '$.answer' },
      { type: 'doc-done', seq: 9, id: 'live-demo' },
    ],
  },
];
