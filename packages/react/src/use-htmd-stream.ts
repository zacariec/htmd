import { RegionTreeRenderer, RendererEvents } from '@htmdjs/renderer';
import type { RendererErrorDetail } from '@htmdjs/renderer';
import type { WireEvent } from '@htmdjs/wire';
import { type RefCallback, useCallback, useEffect, useState } from 'react';

import { ensureHtmdElementsRegistered } from './register.js';

export type HtmdStreamStatus = 'idle' | 'streaming' | 'done' | 'error';

/**
 * Anything that produces wire events. Accepted shapes:
 *
 * - `AsyncIterable<WireEvent>` — the common case (server-driven producer).
 * - `ReadableStream<WireEvent>` — Fetch/Streams API interop.
 * - `EventSource` — SSE endpoint emitting one JSON event per message.
 * - `Iterable<WireEvent>` — a pre-recorded log (tests, replays).
 */
export type HtmdStreamSource =
  | AsyncIterable<WireEvent>
  | ReadableStream<WireEvent>
  | Iterable<WireEvent>
  | EventSource;

export interface UseHtmdStreamResult {
  /** Attach to the container `<div>` that will host the region tree. */
  readonly ref: RefCallback<HTMLDivElement>;
  readonly status: HtmdStreamStatus;
  readonly error: string | undefined;
}

/**
 * Consumes `source` into a `RegionTreeRenderer` mounted on the element passed
 * to `ref`. Status transitions:
 *
 * - `idle` before the first event.
 * - `streaming` from the first event until protocol completion.
 * - `done` only when the renderer accepts `doc-done`.
 * - `error` on interruption, transport failure, or a non-recoverable renderer error.
 */
export function useHtmdStream(source: HtmdStreamSource): UseHtmdStreamResult {
  const [status, setStatus] = useState<HtmdStreamStatus>('idle');
  const [error, setError] = useState<string | undefined>(undefined);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const ref: RefCallback<HTMLDivElement> = useCallback((element) => {
    setContainer(element);
  }, []);

  useEffect(() => {
    setStatus('idle');
    setError(undefined);
    if (container === null) {
      return;
    }
    ensureHtmdElementsRegistered();
    const renderer = new RegionTreeRenderer(container);
    renderer.reset();

    let stopped = false;
    let firstEventSeen = false;
    let cleanup: (() => void) | undefined;
    const stop = (): void => {
      stopped = true;
      cleanup?.();
    };
    const raiseError = (message: string): void => {
      if (stopped) {
        return;
      }
      stop();
      setStatus('error');
      setError(message);
    };
    const handleError = (event: Event): void => {
      const detail = (event as CustomEvent<RendererErrorDetail>).detail;
      if (!detail.recoverable) {
        raiseError(detail.message);
      }
    };
    const handleDone = (): void => {
      if (stopped) {
        return;
      }
      stop();
      setStatus('done');
    };
    renderer.addEventListener(RendererEvents.Error, handleError);
    renderer.addEventListener(RendererEvents.DocDone, handleDone);

    try {
      cleanup = consume(source, {
        isStopped: () => stopped,
        onEvent: (event) => {
          if (stopped) {
            return;
          }
          if (!firstEventSeen) {
            firstEventSeen = true;
            setStatus('streaming');
          }
          renderer.apply(event);
        },
        onEnd: () => {
          if (stopped) {
            return;
          }
          if (firstEventSeen) {
            raiseError('HTMD stream interrupted before doc-done');
          } else {
            stop();
          }
        },
        onError: raiseError,
      });
      // A synchronous iterable can complete before its cleanup is assigned.
      if (stopped) {
        cleanup();
      }
    } catch (error) {
      raiseError(errorMessage(error));
    }

    return () => {
      stop();
      renderer.removeEventListener(RendererEvents.Error, handleError);
      renderer.removeEventListener(RendererEvents.DocDone, handleDone);
    };
  }, [source, container]);

  return { ref, status, error };
}

interface ConsumeCallbacks {
  readonly isStopped: () => boolean;
  readonly onEvent: (event: unknown) => void;
  readonly onEnd: () => void;
  readonly onError: (message: string) => void;
}

/**
 * Dispatches structured wire events through one shared protocol lifecycle.
 * Drivers check cancellation again after every asynchronous read.
 */
function consume(source: HtmdStreamSource, callbacks: ConsumeCallbacks): () => void {
  if (typeof ReadableStream !== 'undefined' && source instanceof ReadableStream) {
    return consumeReadableStream(source, callbacks);
  }
  if (typeof EventSource !== 'undefined' && source instanceof EventSource) {
    return consumeEventSource(source, callbacks);
  }
  if (isAsyncIterable<WireEvent>(source)) {
    return consumeAsyncIterable(source, callbacks);
  }
  return consumeSyncIterable(source as Iterable<WireEvent>, callbacks);
}

function consumeReadableStream(
  stream: ReadableStream<WireEvent>,
  callbacks: ConsumeCallbacks,
): () => void {
  const reader = stream.getReader();
  let finished = false;
  let released = false;
  let cancellationRequested = false;

  void (async (): Promise<void> => {
    try {
      while (!callbacks.isStopped()) {
        const { done, value } = await reader.read();
        if (callbacks.isStopped()) {
          return;
        }
        if (done) {
          finished = true;
          callbacks.onEnd();
          return;
        }
        callbacks.onEvent(value);
      }
    } catch (error) {
      callbacks.onError(errorMessage(error));
    } finally {
      reader.releaseLock();
      released = true;
    }
  })();

  return () => {
    if (!finished && !released && !cancellationRequested) {
      cancellationRequested = true;
      void reader.cancel().catch(() => undefined);
    }
  };
}

function consumeEventSource(source: EventSource, callbacks: ConsumeCallbacks): () => void {
  const handleMessage = (event: MessageEvent<string>): void => {
    if (callbacks.isStopped()) {
      return;
    }
    try {
      callbacks.onEvent(JSON.parse(event.data) as unknown);
    } catch (error) {
      callbacks.onError(errorMessage(error));
    }
  };
  const handleError = (): void => callbacks.onError('EventSource transport error');

  source.addEventListener('message', handleMessage);
  source.addEventListener('error', handleError);

  return () => {
    source.removeEventListener('message', handleMessage);
    source.removeEventListener('error', handleError);
  };
}

function consumeAsyncIterable(
  source: AsyncIterable<WireEvent>,
  callbacks: ConsumeCallbacks,
): () => void {
  const iterator = source[Symbol.asyncIterator]();
  let finished = false;
  let cancellationRequested = false;

  void (async (): Promise<void> => {
    try {
      while (!callbacks.isStopped()) {
        const result = await iterator.next();
        if (callbacks.isStopped()) {
          return;
        }
        if (result.done) {
          finished = true;
          callbacks.onEnd();
          return;
        }
        callbacks.onEvent(result.value);
      }
    } catch (error) {
      callbacks.onError(errorMessage(error));
    }
  })();

  return () => {
    if (!finished && !cancellationRequested) {
      cancellationRequested = true;
      void (async () => {
        await iterator.return?.();
      })().catch(() => undefined);
    }
  };
}

function consumeSyncIterable(source: Iterable<WireEvent>, callbacks: ConsumeCallbacks): () => void {
  try {
    for (const event of source) {
      callbacks.onEvent(event);
      if (callbacks.isStopped()) {
        break;
      }
    }
    callbacks.onEnd();
  } catch (error) {
    callbacks.onError(errorMessage(error));
  }
  return () => undefined;
}

function isAsyncIterable<T>(value: unknown): value is AsyncIterable<T> {
  return value !== null && typeof value === 'object' && Symbol.asyncIterator in (value as object);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
