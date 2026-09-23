import { RegionTreeRenderer } from '@htmdjs/renderer';
import type { WireEvent } from '@htmdjs/wire';
import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WIRE_FIXTURES, type WireFixture } from './fixtures.js';
import { playgroundHost } from './host.js';

type PlaybackState = 'paused' | 'playing' | 'done';
type ChunkMode = 'wire' | 'word' | 'char';

const FRAME_RATES: readonly { readonly label: string; readonly ms: number | undefined }[] = [
  { label: '1 ms', ms: 1 },
  { label: '10 ms', ms: 10 },
  { label: '50 ms', ms: 50 },
  { label: '100 ms', ms: 100 },
  { label: '500 ms', ms: 500 },
  { label: 'Manual', ms: undefined },
];

const CHUNK_MODES: readonly { readonly value: ChunkMode; readonly label: string }[] = [
  { value: 'wire', label: 'Wire chunks (as sent)' },
  { value: 'word', label: 'Split by word' },
  { value: 'char', label: 'Split by character' },
];

/**
 * Expands the fixture's stream events into finer-grained sub-events for the
 * chosen chunk mode. Non-stream events pass through untouched. `seq` is
 * re-numbered from scratch so the materializer's monotonic-seq idempotency
 * still holds across the expanded list.
 */
function expandEvents(events: readonly WireEvent[], mode: ChunkMode): readonly WireEvent[] {
  if (mode === 'wire') {
    return events;
  }
  const expanded: WireEvent[] = [];
  let seq = 0;
  for (const event of events) {
    if (event.type !== 'stream') {
      expanded.push({ ...event, seq });
      seq += 1;
      continue;
    }
    const pieces: readonly string[] =
      mode === 'char' ? [...event.chunk] : (event.chunk.match(/\S+\s*|\s+/g) ?? [event.chunk]);
    for (const piece of pieces) {
      expanded.push({ ...event, seq, chunk: piece });
      seq += 1;
    }
  }
  return expanded;
}

export function StreamingTab(): JSX.Element {
  const [fixtureId, setFixtureId] = useState<string>('11-live-interaction');
  const [chunkMode, setChunkMode] = useState<ChunkMode>('char');
  const [frameRateIndex, setFrameRateIndex] = useState<number>(1);
  const [frameIndex, setFrameIndex] = useState<number>(0);
  const [state, setState] = useState<PlaybackState>('paused');
  const [pendingCount, setPendingCount] = useState(0);
  const [error, setError] = useState<string | undefined>();
  const rendererRef = useRef<RegionTreeRenderer | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const frameIndexRef = useRef<number>(0);

  const fixture: WireFixture =
    WIRE_FIXTURES.find((entry) => entry.id === fixtureId) ?? (WIRE_FIXTURES[0] as WireFixture);
  const effectiveEvents = useMemo(
    () => expandEvents(fixture.events, chunkMode),
    [fixture, chunkMode],
  );
  const totalFrames = effectiveEvents.length;
  const frameRate = FRAME_RATES[frameRateIndex] ?? (FRAME_RATES[1] as (typeof FRAME_RATES)[number]);

  const resetPlayback = useCallback((): void => {
    frameIndexRef.current = 0;
    setFrameIndex(0);
    setState('paused');
    setPendingCount(0);
    setError(undefined);
    rendererRef.current?.reset();
  }, []);

  const stepOnce = useCallback((): void => {
    const renderer = rendererRef.current;
    if (renderer === undefined) {
      return;
    }
    const index = frameIndexRef.current;
    if (index >= effectiveEvents.length) {
      setState('done');
      return;
    }
    if (!renderer.apply(effectiveEvents[index])) {
      setError('The event was rejected. Reset playback to start again.');
      setState('paused');
      return;
    }
    setPendingCount(containerRef.current?.querySelectorAll('[data-htmd-pending]').length ?? 0);
    frameIndexRef.current = index + 1;
    setFrameIndex(index + 1);
    if (index + 1 >= effectiveEvents.length) {
      setState('done');
    }
  }, [effectiveEvents]);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }
    rendererRef.current = new RegionTreeRenderer(container, { host: playgroundHost });
    return () => {
      rendererRef.current = undefined;
      container.replaceChildren();
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on fixture / mode swap.
  useEffect(() => {
    resetPlayback();
  }, [fixtureId, chunkMode]);

  useEffect(() => {
    if (state !== 'playing' || frameRate.ms === undefined) {
      return;
    }
    const timer = window.setInterval(() => {
      stepOnce();
    }, frameRate.ms);
    return () => window.clearInterval(timer);
  }, [state, frameRate.ms, stepOnce]);

  return (
    <>
      <section className="pane">
        <h2>Wire log</h2>
        <div className="controls">
          <select value={fixtureId} onChange={(event) => setFixtureId(event.target.value)}>
            {WIRE_FIXTURES.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
          <select
            value={chunkMode}
            onChange={(event) => setChunkMode(event.target.value as ChunkMode)}
          >
            {CHUNK_MODES.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
          <select
            value={frameRateIndex}
            onChange={(event) => setFrameRateIndex(Number(event.target.value))}
          >
            {FRAME_RATES.map((entry, index) => (
              <option key={entry.label} value={index}>
                {entry.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setState(state === 'playing' ? 'paused' : 'playing')}
            disabled={frameRate.ms === undefined || state === 'done' || error !== undefined}
          >
            {state === 'playing' ? 'Pause' : 'Play'}
          </button>
          <button
            type="button"
            onClick={stepOnce}
            disabled={frameIndex >= totalFrames || error !== undefined}
          >
            Step
          </button>
          <button type="button" onClick={resetPlayback}>
            Reset
          </button>
          <span className="frame">
            frame {frameIndex} / {totalFrames}
          </span>
          <span aria-live="polite">
            {pendingCount > 0 ? `${pendingCount} region(s) have pending syntax` : state}
          </span>
        </div>
        {error === undefined ? null : <p role="alert">{error}</p>}
        <pre className="wire-log">
          {fixture.events
            .map((event, index) => `${index.toString().padStart(2, '0')}  ${JSON.stringify(event)}`)
            .join('\n')}
        </pre>
      </section>
      <section className="pane">
        <h2>Render</h2>
        <div className="render" ref={containerRef} />
      </section>
    </>
  );
}
