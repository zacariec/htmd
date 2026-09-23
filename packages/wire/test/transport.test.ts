import { describe, expect, it } from 'vitest';

import type { WireEvent } from '../src/events.js';
import { WIRE_EVENT_STREAM_HEADERS, readWireEvents, toEventStream } from '../src/transport.js';
import { WireWriter, streamText } from '../src/writer.js';

const encoder = new TextEncoder();

async function collect(events: AsyncIterable<WireEvent>): Promise<WireEvent[]> {
  const collected: WireEvent[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}

/** Streams `bytes` in chunks of `size`; the stream stays open when `close` is false. */
function byteStream(
  bytes: Uint8Array,
  size: number,
  { close = true, onCancel = (): void => {} } = {},
): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (offset < bytes.length) {
          controller.enqueue(bytes.slice(offset, offset + size));
          offset += size;
        } else if (close) {
          controller.close();
        }
      },
      cancel: onCancel,
    },
    { highWaterMark: 0 },
  );
}

function textStream(
  text: string,
  options?: Parameters<typeof byteStream>[2],
): ReadableStream<Uint8Array> {
  const bytes = encoder.encode(text);
  return byteStream(bytes, bytes.length, options);
}

function sampleDocument(): {
  readonly events: readonly WireEvent[];
  readonly json: readonly string[];
} {
  const writer = new WireWriter('doc');
  const events = [
    writer.open(),
    writer.region('$.a'),
    writer.stream('$.a', 'price: 5 € 🎉'),
    writer.done('$.a'),
    writer.close(),
  ];
  return { events, json: events.map((event) => JSON.stringify(event)) };
}

describe('toEventStream → readWireEvents', () => {
  const tokens = ['Hello ', 'wörld: 5 €', ' 🎉 done\n\nnext **line**'];

  for (const format of ['sse', 'jsonl'] as const) {
    it(`round-trips a ${format} document through a Response, split at every byte`, async () => {
      const expected = await collect(streamText(tokens));
      const headers =
        format === 'sse' ? WIRE_EVENT_STREAM_HEADERS : { 'content-type': 'application/x-ndjson' };
      const bytes = new Uint8Array(
        await new Response(toEventStream(streamText(tokens), { format })).arrayBuffer(),
      );

      for (const size of [1, bytes.length]) {
        const response = new Response(byteStream(bytes, size), { headers });
        expect(await collect(readWireEvents(response))).toEqual(expected);
      }
      expect(
        await collect(readWireEvents(Promise.resolve(new Response(bytes, { headers })))),
      ).toEqual(expected);
    });
  }
});

describe('readWireEvents', () => {
  it('follows SSE parsing rules: line endings, comments, multi-line data, named events, EOF', async () => {
    const { events, json } = sampleDocument();
    const comma = (json[0] ?? '').indexOf(',') + 1;
    const text = [
      ': connected\r\n',
      'retry: 3000\r\n',
      '\r\n',
      'event: progress\r\n',
      'data: {"not":"a wire event"}\r\n\r\n',
      `id: 1\r\ndata: ${json[0]?.slice(0, comma)}\r\ndata: ${json[0]?.slice(comma)}\r\n\r\n`,
      ':heartbeat\r',
      `event: message\rdata:${json[1]}\r\r`,
      `data: ${json[2]}\n\n`,
      `data: ${json[3]}\n`,
    ].join('');
    const bytes = encoder.encode(text);

    for (const size of [1, bytes.length]) {
      const read = await collect(readWireEvents(byteStream(bytes, size), { format: 'sse' }));
      expect(read).toEqual(events.slice(0, 3));
    }
  });

  it('chooses the framing from the Response content type, or the first line of a bare stream', async () => {
    const { events, json } = sampleDocument();
    const sse = `data: ${json[0]}\n\n`;
    const jsonl = `${json[0]}\n`;

    expect(await collect(readWireEvents(textStream(`\n: hi\n${sse}`)))).toEqual([events[0]]);
    expect(await collect(readWireEvents(textStream(`\n${sse}`)))).toEqual([events[0]]);
    expect(await collect(readWireEvents(textStream(`\r\n${jsonl}`)))).toEqual([events[0]]);
    expect(await collect(readWireEvents(textStream(json[0] ?? '')))).toEqual([events[0]]);

    const sseResponse = new Response(sse, { headers: { 'content-type': 'Text/Event-Stream' } });
    expect(await collect(readWireEvents(sseResponse))).toEqual([events[0]]);
    const mislabelled = new Response(sse, { headers: { 'content-type': 'application/json' } });
    await expect(collect(readWireEvents(mislabelled))).rejects.toThrow(
      'wire message 1 is not valid JSON',
    );
    const forced = new Response(sse, { headers: { 'content-type': 'application/json' } });
    expect(await collect(readWireEvents(forced, { format: 'sse' }))).toEqual([events[0]]);
  });

  it('rejects a failed HTTP response with its status', async () => {
    const response = new Response('upstream down', { status: 502, statusText: 'Bad Gateway' });
    await expect(collect(readWireEvents(Promise.resolve(response)))).rejects.toThrow(
      'HTTP 502 Bad Gateway',
    );
  });

  it('names the failing message for malformed JSON or an invalid event, and cancels the body', async () => {
    const { json } = sampleDocument();
    await expect(collect(readWireEvents(textStream(`${json[0]}\n{oops\n`)))).rejects.toThrow(
      'wire message 2 is not valid JSON',
    );

    let cancelled = false;
    const invalid = textStream(
      `${json[0]}\n\n${json[1]}\n{"type":"stream","seq":2,"target":"$.a"}\n`,
      {
        close: false,
        onCancel: () => {
          cancelled = true;
        },
      },
    );
    await expect(collect(readWireEvents(invalid))).rejects.toThrow(
      /wire message 3 is not a valid wire event:[\s\S]*chunk/,
    );
    expect(cancelled).toBe(true);
    expect(invalid.locked).toBe(false);
  });

  it('cancels the body when the consumer stops early', async () => {
    const { events, json } = sampleDocument();
    let cancelled = false;
    const body = textStream(`${json[0]}\n${json[1]}\n`, {
      close: false,
      onCancel: () => {
        cancelled = true;
      },
    });
    const read = readWireEvents(body);

    expect((await read.next()).value).toEqual(events[0]);
    await read.return();
    expect(cancelled).toBe(true);
    expect(body.locked).toBe(false);
  });

  it('cancels the body and throws the reason when the signal aborts a pending read', async () => {
    const { events, json } = sampleDocument();
    let cancelled = false;
    const body = textStream(`${json[0]}\n`, {
      close: false,
      onCancel: () => {
        cancelled = true;
      },
    });
    const controller = new AbortController();
    const read = readWireEvents(body, { signal: controller.signal });

    expect((await read.next()).value).toEqual(events[0]);
    const pending = read.next();
    controller.abort(new Error('user left'));
    await expect(pending).rejects.toThrow('user left');
    expect(cancelled).toBe(true);
    expect(body.locked).toBe(false);
  });
});

describe('toEventStream', () => {
  it('pulls one event per read instead of draining the source ahead of the consumer', async () => {
    const { events } = sampleDocument();
    let reads = 0;
    const readsWhenProduced: number[] = [];
    function* source(): Generator<WireEvent> {
      for (const event of events) {
        readsWhenProduced.push(reads);
        yield event;
      }
    }
    // Proving the stream does NOT pull ahead has no event to await, so let the
    // event loop drain every pending pull before each check.
    const settle = (): Promise<void> => {
      const settled = Promise.withResolvers<void>();
      setTimeout(settled.resolve, 0);
      return settled.promise;
    };
    const reader = toEventStream(source()).getReader();
    await settle();
    expect(readsWhenProduced).toEqual([]);
    for (const _ of events) {
      reads++;
      await reader.read();
      await settle();
    }
    expect(readsWhenProduced).toEqual([1, 2, 3, 4, 5]);
  });

  it('closes the text source through streamText when the stream is cancelled', async () => {
    let sourceClosed = false;
    async function* tokens(): AsyncGenerator<string> {
      try {
        for (;;) {
          yield 'tick ';
        }
      } finally {
        sourceClosed = true;
      }
    }
    const reader = toEventStream(streamText(tokens())).getReader();
    await reader.read();
    await reader.read();
    await reader.read();
    await reader.cancel();
    expect(sourceClosed).toBe(true);
  });

  it('errors the stream when the source throws, after the events before it', async () => {
    async function* tokens(): AsyncGenerator<string> {
      yield 'partial';
      throw new Error('model crashed');
    }
    const seen: WireEvent[] = [];
    const read = async (): Promise<void> => {
      for await (const event of readWireEvents(
        toEventStream(streamText(tokens()), { format: 'jsonl' }),
      )) {
        seen.push(event);
      }
    };
    await expect(read()).rejects.toThrow('model crashed');
    expect(seen.map((event) => event.type)).toEqual(['doc-open', 'region', 'stream', 'error']);
  });
});
