import { describe, expect, it } from 'vitest';

import { WireEvent } from '../src/events.js';
import { WireWriter, streamText } from '../src/writer.js';

async function collect(events: AsyncIterable<WireEvent>): Promise<WireEvent[]> {
  const collected: WireEvent[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}

describe('WireWriter', () => {
  it('numbers every kind of event strictly increasing, so consumers never skip one as a replay', () => {
    const writer = new WireWriter('doc');
    const events = [
      writer.open(),
      writer.region('$.msg', { tag: 'article', attrs: { lang: 'en' } }),
      writer.region('$.aside', { parent: '$.msg' }),
      writer.stream('$.msg', 'Hello'),
      writer.error('retrying', { recoverable: true, region: '$.msg' }),
      writer.replace('$.msg', 'Revised'),
      writer.done('$.msg'),
      writer.close(),
    ];
    expect(events.map((event) => WireEvent.parse(event))).toEqual(events);
    expect(events.map((event) => event.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('rejects invalid region ids without consuming a sequence number', () => {
    const writer = new WireWriter('doc');
    expect(() => writer.stream('answer', 'x')).toThrow('invalid region id "answer"');
    expect(() => writer.region('$.a', { parent: '$..b' })).toThrow('invalid region id "$..b"');
    expect(() => writer.error('x', { region: 'nope' })).toThrow('invalid region id "nope"');
    expect(writer.open().seq).toBe(0);
  });

  it('ends the document on close or a fatal error, but not on a recoverable one', () => {
    const closed = new WireWriter('a');
    closed.close();
    expect(() => closed.stream('$.a', 'late')).toThrow('document "a" is closed');

    const failed = new WireWriter('b');
    failed.error('upstream failed');
    expect(() => failed.close()).toThrow('document "b" is closed');

    const recovered = new WireWriter('c');
    recovered.error('slow', { recoverable: true });
    expect(recovered.stream('$.c', 'continues').seq).toBe(1);
  });
});

describe('streamText', () => {
  it('produces a complete document, skipping empty chunks', async () => {
    const events = await collect(streamText(['# Hi', '', ' there'], { docId: 'd', region: '$.a' }));
    expect(events.map((event) => event.type)).toEqual([
      'doc-open',
      'region',
      'stream',
      'stream',
      'region-done',
      'doc-done',
    ]);
    expect(events.at(-1)).toMatchObject({ type: 'doc-done', id: 'd' });
  });

  it('reports a failing source as a fatal error event, then rethrows it', async () => {
    const failure = new Error('model connection dropped');
    async function* tokens(): AsyncGenerator<string> {
      yield 'partial ';
      throw failure;
    }
    const received: WireEvent[] = [];
    await expect(
      (async () => {
        for await (const event of streamText(tokens(), { region: '$.answer' })) {
          received.push(event);
        }
      })(),
    ).rejects.toBe(failure);
    expect(received.at(-1)).toMatchObject({
      type: 'error',
      message: 'model connection dropped',
      recoverable: false,
      region: '$.answer',
    });
  });

  it('closes the source when the consumer stops early, so generation stops', async () => {
    let closed = false;
    async function* tokens(): AsyncGenerator<string> {
      try {
        for (;;) {
          yield 'token ';
        }
      } finally {
        closed = true;
      }
    }
    for await (const event of streamText(tokens())) {
      if (event.type === 'stream') {
        break;
      }
    }
    expect(closed).toBe(true);
  });

  it('rejects an invalid region before producing any event', async () => {
    const events = streamText(['x'], { region: 'answer' });
    await expect(events.next()).rejects.toThrow('invalid region id "answer"');
  });
});
