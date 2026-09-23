import { z } from 'zod';

import { safeParseWireEvent } from './events.js';
import type { WireEvent } from './events.js';

/**
 * HTTP transport for wire events. `fetch` can POST a prompt and send auth
 * headers, which `EventSource` cannot, so clients read the response body with
 * `readWireEvents` and servers produce it with `toEventStream`.
 */

/** Response headers for a server-sent-events body produced by `toEventStream`. */
export const WIRE_EVENT_STREAM_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache',
} as const;

export interface ReadWireEventsOptions {
  /**
   * Body framing; default `auto`. `auto` reads a `Response` as SSE when its
   * content type is `text/event-stream` and as JSONL otherwise. A bare stream
   * is SSE when its first non-blank line is an SSE field or comment.
   */
  readonly format?: 'auto' | 'sse' | 'jsonl';
  /** Aborting cancels the body; iteration then throws the signal's reason. */
  readonly signal?: AbortSignal;
}

export interface ToEventStreamOptions {
  /** Body framing; default `sse`. */
  readonly format?: 'sse' | 'jsonl';
}

/**
 * Reads wire events from an HTTP response (or its promise, such as the
 * result of `fetch`) or a byte stream, validating each one.
 *
 * - A response that is not ok throws `HTTP <status> <statusText>`.
 * - A message that is not JSON or not a wire event throws an error naming its
 *   1-based message number.
 * - Stopping early, aborting `signal`, or any error cancels the body.
 */
export async function* readWireEvents(
  input: Response | Promise<Response> | ReadableStream<Uint8Array>,
  options: ReadWireEventsOptions = {},
): AsyncGenerator<WireEvent, void, undefined> {
  const { signal } = options;
  signal?.throwIfAborted();
  const source = await input;
  const { body, format } = await openBody(source, options.format ?? 'auto');
  const reader = body.getReader();
  const abort = (): void => {
    reader.cancel(signal?.reason).catch(ignore);
  };
  signal?.addEventListener('abort', abort, { once: true });
  let exhausted = false;
  try {
    signal?.throwIfAborted();
    const framer = new MessageFramer(format);
    let count = 0;
    for (;;) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) {
        exhausted = true;
        break;
      }
      for (const payload of framer.push(value)) {
        yield parseMessage(payload, ++count);
        signal?.throwIfAborted();
      }
    }
    for (const payload of framer.end()) {
      yield parseMessage(payload, ++count);
    }
  } finally {
    signal?.removeEventListener('abort', abort);
    if (!exhausted) {
      await reader.cancel(signal?.reason).catch(ignore);
    }
    reader.releaseLock();
  }
}

/**
 * Encodes wire events as an HTTP body: SSE `data:` frames by default, or one
 * JSON object per line. The stream pulls one event at a time as the consumer
 * reads; cancelling it closes `events` (so `streamText` closes its source),
 * and an error from `events` errors the stream.
 */
export function toEventStream(
  events: AsyncIterable<WireEvent> | Iterable<WireEvent>,
  options: ToEventStreamOptions = {},
): ReadableStream<Uint8Array> {
  const jsonl = options.format === 'jsonl';
  const encoder = new TextEncoder();
  const iterator: AsyncIterator<WireEvent> | Iterator<WireEvent> =
    Symbol.asyncIterator in events ? events[Symbol.asyncIterator]() : events[Symbol.iterator]();
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        const result = await iterator.next();
        if (result.done === true) {
          controller.close();
          return;
        }
        const json = JSON.stringify(result.value);
        controller.enqueue(encoder.encode(jsonl ? `${json}\n` : `data: ${json}\n\n`));
      },
      async cancel() {
        await iterator.return?.();
      },
    },
    { highWaterMark: 0 },
  );
}

type Format = 'sse' | 'jsonl';

async function openBody(
  source: Response | ReadableStream<Uint8Array>,
  format: 'auto' | Format,
): Promise<{ readonly body: ReadableStream<Uint8Array>; readonly format: Format | undefined }> {
  if (!('headers' in source)) {
    return { body: source, format: format === 'auto' ? undefined : format };
  }
  if (!source.ok) {
    await source.body?.cancel().catch(ignore);
    throw new Error(
      `HTTP ${source.status}${source.statusText === '' ? '' : ` ${source.statusText}`}`,
    );
  }
  if (source.body === null) {
    throw new Error(`HTTP ${source.status} response has no body`);
  }
  if (format !== 'auto') {
    return { body: source.body, format };
  }
  const contentType = source.headers.get('content-type')?.toLowerCase() ?? '';
  return {
    body: source.body,
    format: contentType.startsWith('text/event-stream') ? 'sse' : 'jsonl',
  };
}

function parseMessage(payload: string, message: number): WireEvent {
  let raw: unknown;
  try {
    raw = JSON.parse(payload) as unknown;
  } catch (error) {
    throw new Error(
      `wire message ${message} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      {
        cause: error,
      },
    );
  }
  const result = safeParseWireEvent(raw);
  if (!result.success) {
    throw new Error(
      `wire message ${message} is not a valid wire event: ${z.prettifyError(result.error)}`,
      {
        cause: result.error,
      },
    );
  }
  return result.data;
}

/** Collects the lines of one message format and yields message payloads. */
interface Framing {
  line(line: string): string | undefined;
  /** Handles an unterminated final line. */
  end(rest: string): string | undefined;
}

/** Server-sent events, per the HTML event stream interpretation rules. */
class SseFraming implements Framing {
  #data: string[] = [];
  #event = '';

  line(line: string): string | undefined {
    if (line === '') {
      const data = this.#data;
      const event = this.#event;
      this.#data = [];
      this.#event = '';
      // Named events other than `message` belong to other consumers.
      return data.length > 0 && (event === '' || event === 'message') ? data.join('\n') : undefined;
    }
    if (line.startsWith(':')) {
      return undefined;
    }
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const value =
      colon === -1 ? '' : line.slice(line.startsWith(' ', colon + 1) ? colon + 2 : colon + 1);
    if (field === 'data') {
      this.#data.push(value);
    } else if (field === 'event') {
      this.#event = value;
    }
    return undefined;
  }

  /** A message without its closing blank line is incomplete and discarded. */
  end(): undefined {
    return undefined;
  }
}

/** One JSON value per non-blank line. */
class JsonlFraming implements Framing {
  line(line: string): string | undefined {
    return line.trim() === '' ? undefined : line;
  }

  end(rest: string): string | undefined {
    return this.line(rest);
  }
}

const SSE_LINE = /^(?:data:|event:|id:|retry:|:)/;

/** Decodes UTF-8 bytes into lines (`\n`, `\r\n`, or `\r`) and frames them into message payloads. */
class MessageFramer {
  readonly #decoder = new TextDecoder();
  #framing: Framing | undefined;
  #partial = '';
  /** The previous text ended in `\r`, so a leading `\n` completes that line ending. */
  #skipLineFeed = false;

  constructor(format: Format | undefined) {
    this.#framing =
      format === 'sse' ? new SseFraming() : format === 'jsonl' ? new JsonlFraming() : undefined;
  }

  *push(bytes: Uint8Array): Generator<string, void, undefined> {
    yield* this.#lines(this.#decoder.decode(bytes, { stream: true }));
  }

  *end(): Generator<string, void, undefined> {
    yield* this.#lines(this.#decoder.decode());
    const rest = this.#partial;
    this.#partial = '';
    if (rest !== '') {
      const payload = this.#frame(rest)?.end(rest);
      if (payload !== undefined) {
        yield payload;
      }
    }
  }

  /** Picks the framing from the first non-blank line; blank lines mean nothing in either format. */
  #frame(line: string): Framing | undefined {
    if (this.#framing === undefined && line.trim() !== '') {
      this.#framing = SSE_LINE.test(line) ? new SseFraming() : new JsonlFraming();
    }
    return this.#framing;
  }

  *#lines(text: string): Generator<string, void, undefined> {
    if (text === '') {
      return;
    }
    let start = this.#skipLineFeed && text.startsWith('\n') ? 1 : 0;
    this.#skipLineFeed = false;
    for (let index = start; index < text.length; index++) {
      const code = text.charCodeAt(index);
      if (code !== LF && code !== CR) {
        continue;
      }
      const line = this.#partial + text.slice(start, index);
      this.#partial = '';
      if (code === CR) {
        if (index + 1 === text.length) {
          this.#skipLineFeed = true;
        } else if (text.charCodeAt(index + 1) === LF) {
          index++;
        }
      }
      start = index + 1;
      const payload = this.#frame(line)?.line(line);
      if (payload !== undefined) {
        yield payload;
      }
    }
    this.#partial += text.slice(start);
  }
}

const LF = 0x0a;
const CR = 0x0d;

function ignore(): void {}
