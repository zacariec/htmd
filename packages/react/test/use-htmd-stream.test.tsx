import { setHtmdElementsLogSink } from '@htmdjs/elements';
import type { WireEvent } from '@htmdjs/wire';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  type HtmdStreamSource,
  type UseHtmdStreamOptions,
  useHtmdStream,
} from '../src/use-htmd-stream.js';

beforeAll(() => {
  setHtmdElementsLogSink({ warn: () => {}, error: () => {} });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function StreamHarness({
  source,
  options,
}: {
  readonly source: HtmdStreamSource;
  readonly options?: UseHtmdStreamOptions;
}): JSX.Element {
  const { ref, status, error } = useHtmdStream(source, options);
  return (
    <div>
      <div data-testid="host" ref={ref} />
      <div data-testid="status">{status}</div>
      <div data-testid="error">{error ?? ''}</div>
    </div>
  );
}

const FIXTURE: readonly WireEvent[] = [
  { type: 'doc-open', seq: 0, id: 'd', schemaVersion: '0.1' },
  { type: 'region', seq: 1, id: '$.msg', tag: 'div' },
  { type: 'stream', seq: 2, target: '$.msg', chunk: '# hello' },
  { type: 'region-done', seq: 3, id: '$.msg' },
  { type: 'doc-done', seq: 4, id: 'd' },
];

async function nextTick(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

class FakeEventSource extends EventTarget {
  readonly close = vi.fn();

  emit(event: WireEvent): void {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(event) }));
  }
}

const finiteSources: readonly [string, (events: readonly WireEvent[]) => HtmdStreamSource][] = [
  ['iterable', (events) => events],
  [
    'async iterable',
    async function* (events) {
      yield* events;
    },
  ],
  [
    'readable stream',
    (events) =>
      new ReadableStream<WireEvent>({
        start(controller) {
          for (const event of events) {
            controller.enqueue(event);
          }
          controller.close();
        },
      }),
  ],
];

describe('useHtmdStream', () => {
  it('consumes a synchronous iterable and reaches "done"', async () => {
    const { getByTestId } = render(<StreamHarness source={FIXTURE} />);
    await nextTick();

    expect(getByTestId('host').querySelector('h1')?.textContent).toBe('hello');
    await waitFor(() => expect(getByTestId('status').textContent).toBe('done'));
  });

  it('consumes an async iterable', async () => {
    async function* produce(): AsyncGenerator<WireEvent> {
      for (const event of FIXTURE) {
        yield event;
      }
    }

    const { getByTestId } = render(<StreamHarness source={produce()} />);
    await waitFor(() => expect(getByTestId('status').textContent).toBe('done'));
    expect(getByTestId('host').querySelector('h1')?.textContent).toBe('hello');
  });

  it('reports transport errors from async iterables', async () => {
    async function* explode(): AsyncGenerator<WireEvent> {
      yield FIXTURE[0] as WireEvent;
      throw new Error('boom');
    }

    const { getByTestId } = render(<StreamHarness source={explode()} />);
    await waitFor(() => expect(getByTestId('status').textContent).toBe('error'));
    expect(getByTestId('error').textContent).toBe('boom');
  });

  it('reports non-recoverable renderer errors', async () => {
    async function* stream(): AsyncGenerator<WireEvent> {
      yield FIXTURE[0] as WireEvent;
      yield {
        type: 'error',
        seq: 5,
        message: 'unrecoverable',
        recoverable: false,
      } satisfies WireEvent;
    }

    const { getByTestId } = render(<StreamHarness source={stream()} />);
    await waitFor(() => expect(getByTestId('status').textContent).toBe('error'));
    expect(getByTestId('error').textContent).toBe('unrecoverable');
  });

  it('marks status "streaming" as soon as the first event is applied', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    async function* produce(): AsyncGenerator<WireEvent> {
      yield FIXTURE[0] as WireEvent;
      await gate;
      for (let index = 1; index < FIXTURE.length; index += 1) {
        yield FIXTURE[index] as WireEvent;
      }
    }

    const { getByTestId } = render(<StreamHarness source={produce()} />);
    await waitFor(() => expect(getByTestId('status').textContent).toBe('streaming'));

    release?.();
    await waitFor(() => expect(getByTestId('status').textContent).toBe('done'));
  });

  it.each(finiteSources)('reports a truncated %s as interruption', async (_name, createSource) => {
    const { getByTestId } = render(<StreamHarness source={createSource(FIXTURE.slice(0, -1))} />);

    await waitFor(() => expect(getByTestId('status').textContent).toBe('error'));
    expect(getByTestId('host').querySelector('h1')?.textContent).toBe('hello');
    expect(getByTestId('error').textContent).toMatch(/interrupted.*doc-done/i);
  });

  it.each(finiteSources)('keeps an empty %s idle', async (_name, createSource) => {
    const { getByTestId } = render(<StreamHarness source={createSource([])} />);
    await nextTick();

    expect(getByTestId('status').textContent).toBe('idle');
    expect(getByTestId('error').textContent).toBe('');
  });

  it('completes SSE on doc-done without closing the caller-owned connection', () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const source = new FakeEventSource();
    const { getByTestId } = render(<StreamHarness source={source as unknown as EventSource} />);

    act(() => {
      for (const event of FIXTURE) {
        source.emit(event);
      }
    });
    expect(getByTestId('status').textContent).toBe('done');
    expect(getByTestId('host').querySelector('h1')?.textContent).toBe('hello');

    act(() => {
      source.emit({ type: 'stream', seq: 5, target: '$.late', chunk: 'late' });
      source.dispatchEvent(new Event('error'));
    });
    expect(getByTestId('status').textContent).toBe('done');
    expect(getByTestId('host').textContent).toBe('hello');
    expect(source.close).not.toHaveBeenCalled();
  });

  it('preserves an active renderer through rerenders', () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const source = new FakeEventSource();
    const typedSource = source as unknown as EventSource;
    const { getByTestId, rerender } = render(<StreamHarness source={typedSource} />);
    act(() => {
      for (const event of FIXTURE.slice(0, 3)) {
        source.emit(event);
      }
    });
    const region = getByTestId('host').firstElementChild;
    rerender(<StreamHarness source={typedSource} />);
    act(() => {
      source.emit({ type: 'stream', seq: 3, target: '$.msg', chunk: ' world' });
      source.emit({ type: 'doc-done', seq: 4, id: 'd' });
    });

    expect(getByTestId('status').textContent).toBe('done');
    expect(getByTestId('host').firstElementChild).toBe(region);
    expect(getByTestId('host').querySelector('h1')?.textContent).toBe('hello world');
  });

  it('stops pulling after completion and returns the iterator', async () => {
    let closed = false;
    let pulledPastDone = false;
    async function* produce(): AsyncGenerator<WireEvent> {
      try {
        yield* FIXTURE;
        pulledPastDone = true;
        yield { type: 'stream', seq: 5, target: '$.late', chunk: 'late' };
      } finally {
        closed = true;
      }
    }
    const { getByTestId } = render(<StreamHarness source={produce()} />);

    await waitFor(() => expect(getByTestId('status').textContent).toBe('done'));
    expect(closed).toBe(true);
    expect(pulledPastDone).toBe(false);
    expect(getByTestId('host').textContent).toBe('hello');
  });

  it('stops synchronous consumption on a fatal renderer error', () => {
    let pulledPastError = false;
    function* produce(): Generator<WireEvent> {
      yield FIXTURE[0] as WireEvent;
      yield { type: 'error', seq: 1, message: 'fatal', recoverable: false };
      pulledPastError = true;
      yield { type: 'doc-done', seq: 2, id: 'd' };
    }
    const { getByTestId } = render(<StreamHarness source={produce()} />);

    expect(getByTestId('status').textContent).toBe('error');
    expect(getByTestId('error').textContent).toBe('fatal');
    expect(pulledPastError).toBe(false);
  });

  it('cancels and releases a readable stream on protocol completion', async () => {
    const cancel = vi.fn();
    const source = new ReadableStream<WireEvent>({
      start(controller) {
        for (const event of FIXTURE) {
          controller.enqueue(event);
        }
        controller.enqueue({ type: 'stream', seq: 5, target: '$.late', chunk: 'late' });
      },
      cancel,
    });
    const { getByTestId } = render(<StreamHarness source={source} />);

    await waitFor(() => expect(getByTestId('status').textContent).toBe('done'));
    expect(cancel).toHaveBeenCalledOnce();
    expect(source.locked).toBe(false);
    expect(getByTestId('host').textContent).toBe('hello');
  });

  it('does not apply a pending readable-stream result after unmount', async () => {
    let controller: ReadableStreamDefaultController<WireEvent> | undefined;
    const cancel = vi.fn();
    const source = new ReadableStream<WireEvent>({
      start(value) {
        controller = value;
      },
      cancel,
    });
    const { getByTestId, unmount } = render(<StreamHarness source={source} />);
    const host = getByTestId('host');
    act(() => {
      controller?.enqueue({ type: 'stream', seq: 0, target: '$.late', chunk: 'late' });
      unmount();
    });
    await nextTick();

    expect(host.textContent).toBe('');
    expect(cancel).toHaveBeenCalledOnce();
    expect(source.locked).toBe(false);
  });

  it('ignores an async result from a replaced source', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let closed = false;
    async function* produce(): AsyncGenerator<WireEvent> {
      try {
        yield FIXTURE[0] as WireEvent;
        await gate;
        yield { type: 'stream', seq: 1, target: '$.late', chunk: 'late' };
      } finally {
        closed = true;
      }
    }
    const { getByTestId, rerender } = render(<StreamHarness source={produce()} />);
    await waitFor(() => expect(getByTestId('status').textContent).toBe('streaming'));
    rerender(<StreamHarness source={FIXTURE} />);
    await act(async () => {
      release?.();
      await gate;
    });
    await nextTick();

    expect(closed).toBe(true);
    expect(getByTestId('status').textContent).toBe('done');
    expect(getByTestId('error').textContent).toBe('');
    expect(getByTestId('host').textContent).toBe('hello');
  });

  it('clears terminal status, errors, and content when replacing the source', async () => {
    const failed: readonly WireEvent[] = [
      ...FIXTURE.slice(0, 3),
      { type: 'error', seq: 3, message: 'fatal', recoverable: false },
    ];
    const { getByTestId, rerender } = render(<StreamHarness source={failed} />);
    expect(getByTestId('status').textContent).toBe('error');
    expect(getByTestId('error').textContent).toBe('fatal');
    rerender(<StreamHarness source={[]} />);
    await nextTick();

    expect(getByTestId('status').textContent).toBe('idle');
    expect(getByTestId('error').textContent).toBe('');
    expect(getByTestId('host').textContent).toBe('');
  });

  it('applies render limits by value without restarting on equal inline options', () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const source = new FakeEventSource();
    const typedSource = source as unknown as EventSource;
    const { getByTestId, rerender } = render(
      <StreamHarness source={typedSource} options={{ limits: { maxRegions: 1 } }} />,
    );
    act(() => {
      for (const event of FIXTURE.slice(0, 3)) {
        source.emit(event);
      }
    });
    const region = getByTestId('host').firstElementChild;
    rerender(<StreamHarness source={typedSource} options={{ limits: { maxRegions: 1 } }} />);
    act(() => {
      source.emit({ type: 'stream', seq: 3, target: '$.other', chunk: 'over the limit' });
    });

    expect(getByTestId('host').firstElementChild).toBe(region);
    expect(getByTestId('status').textContent).toBe('error');
    expect(getByTestId('error').textContent).toMatch(/limit of 1 regions/);
    expect(getByTestId('host').textContent).toBe('hello');
  });
});
