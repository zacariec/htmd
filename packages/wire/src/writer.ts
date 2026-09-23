import { RegionId } from './events.js';
import type {
  DocDoneEvent,
  DocOpenEvent,
  HtmdErrorEvent,
  RegionDoneEvent,
  RegionEvent,
  RegionReplaceEvent,
  StreamEvent,
  WireEvent,
} from './events.js';

/** The wire schema version this package produces and renderers accept. */
export const SCHEMA_VERSION = '0.1';

export interface WireRegionOptions {
  /** Element tag for the region; default `div`. */
  readonly tag?: string;
  /** Explicit parent region; default: the region at the id's path prefix. */
  readonly parent?: string;
  readonly attrs?: Readonly<Record<string, string>>;
}

export interface WireErrorOptions {
  /** Default false: a fatal error closes the document for the consumer and this writer. */
  readonly recoverable?: boolean;
  /** Region the error concerns; omit for the whole document. */
  readonly region?: string;
}

/**
 * Builds the events of one document, in order.
 *
 * The writer owns sequence numbering, so producers never number events by
 * hand, and it validates region ids so mistakes fail in the producer instead
 * of being rejected by the consumer. It does not send anything: pass each
 * event to a renderer, an SSE response, or a JSONL log.
 *
 * `close()` and a fatal `error()` end the document; later calls throw.
 */
export class WireWriter {
  private seq = 0;
  private closed = false;

  public constructor(public readonly docId: string) {}

  public open(): DocOpenEvent {
    return { type: 'doc-open', seq: this.take(), id: this.docId, schemaVersion: SCHEMA_VERSION };
  }

  public region(id: string, options: WireRegionOptions = {}): RegionEvent {
    const region = regionId(id);
    const parent = options.parent === undefined ? undefined : regionId(options.parent);
    return {
      type: 'region',
      seq: this.take(),
      id: region,
      tag: options.tag ?? 'div',
      ...(parent === undefined ? {} : { parent }),
      ...(options.attrs === undefined ? {} : { attrs: { ...options.attrs } }),
    };
  }

  public stream(target: string, chunk: string): StreamEvent {
    const id = regionId(target);
    return { type: 'stream', seq: this.take(), target: id, chunk };
  }

  public done(id: string): RegionDoneEvent {
    const region = regionId(id);
    return { type: 'region-done', seq: this.take(), id: region };
  }

  public replace(id: string, body: string): RegionReplaceEvent {
    const region = regionId(id);
    return { type: 'region-replace', seq: this.take(), id: region, body };
  }

  public error(message: string, options: WireErrorOptions = {}): HtmdErrorEvent {
    const recoverable = options.recoverable ?? false;
    const region = options.region === undefined ? undefined : regionId(options.region);
    const event: HtmdErrorEvent = {
      type: 'error',
      seq: this.take(),
      message,
      recoverable,
      ...(region === undefined ? {} : { region }),
    };
    this.closed ||= !recoverable;
    return event;
  }

  public close(): DocDoneEvent {
    const event: DocDoneEvent = { type: 'doc-done', seq: this.take(), id: this.docId };
    this.closed = true;
    return event;
  }

  private take(): number {
    if (this.closed) {
      throw new Error(`document "${this.docId}" is closed; start a new WireWriter`);
    }
    const seq = this.seq;
    this.seq += 1;
    return seq;
  }
}

export interface StreamTextOptions extends WireRegionOptions {
  /** Document id; default `"htmd"`. */
  readonly docId?: string;
  /** Region the text streams into; default `"$.body"`. */
  readonly region?: string;
}

/**
 * Turns streamed text, such as model output, into a complete wire document:
 * open it, declare one region, send one `stream` event per non-empty chunk,
 * then finalize the region and close the document.
 *
 * - Stopping early (`return()`, as `useHtmdStream` does on unmount) also
 *   closes `source`, so upstream generation stops.
 * - If `source` throws, a fatal `error` event is yielded and the original
 *   error is rethrown to whoever is iterating.
 * - An invalid region id rejects before any event is produced.
 */
export async function* streamText(
  source: AsyncIterable<string> | Iterable<string>,
  options: StreamTextOptions = {},
): AsyncGenerator<WireEvent, void, undefined> {
  const region = options.region ?? '$.body';
  const writer = new WireWriter(options.docId ?? 'htmd');
  const open = writer.open();
  const declare = writer.region(region, options);
  yield open;
  yield declare;
  try {
    for await (const chunk of source) {
      if (chunk.length > 0) {
        yield writer.stream(region, chunk);
      }
    }
  } catch (error) {
    yield writer.error(error instanceof Error ? error.message : String(error), { region });
    throw error;
  }
  yield writer.done(region);
  yield writer.close();
}

function regionId(id: string): string {
  if (!RegionId.safeParse(id).success) {
    throw new Error(`invalid region id "${id}": use a $-rooted dot path such as "$.answer"`);
  }
  return id;
}
