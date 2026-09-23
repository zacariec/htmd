import { ComponentEvents, baseCatalog } from '@htmdjs/contracts';
import type { ChoiceDetail, HtmdDiagnostic, HtmdHost, RefineDetail } from '@htmdjs/contracts';
import type { RefinePrompt } from '@htmdjs/elements';
import { DEFAULT_RENDER_LIMITS, RegionTreeRenderer, RendererEvents } from '@htmdjs/renderer';
import type { RegionUpdatedDetail, RenderLimits, RendererErrorDetail } from '@htmdjs/renderer';
import { WireWriter } from '@htmdjs/wire';
import type { JSX } from 'react';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';

import { createPlaygroundHost } from './host.js';
import type { PlaygroundPermissions } from './host.js';
import { KITCHEN_SINK_HTMD } from './kitchen-sink-sample.js';

type ChunkMode = 'char' | 'word' | 'line' | 'random';
type Status = 'idle' | 'playing' | 'paused' | 'done' | 'failed';
type LimitPreset = 'default' | 'tight';

const REGION = '$.answer';
const DOC_ID = 'kitchen-sink';
const RANDOM_MAX_CHUNK = 16;
const TIGHT_REGION_BYTES = 2048;
const HOST_ACK_MS = 1200;
const LOG_SIZE = 40;

const CHUNK_MODES: Readonly<Record<ChunkMode, string>> = {
  char: 'By character',
  word: 'By word',
  line: 'By line',
  random: `Random (1–${RANDOM_MAX_CHUNK} chars)`,
};

const SPEEDS: readonly { readonly label: string; readonly ms: number }[] = [
  { label: 'Fast', ms: 6 },
  { label: 'Normal', ms: 25 },
  { label: 'Slow', ms: 80 },
  { label: 'Crawl', ms: 250 },
];

const LIMITS: Readonly<
  Record<LimitPreset, { readonly label: string; readonly limits: Partial<RenderLimits> }>
> = {
  default: {
    label: `Default (${DEFAULT_RENDER_LIMITS.maxRegionBytes.toLocaleString()} bytes per region)`,
    limits: {},
  },
  tight: {
    label: `Tight (${TIGHT_REGION_BYTES.toLocaleString()} bytes per region)`,
    limits: { maxRegionBytes: TIGHT_REGION_BYTES },
  },
};

const PERMISSIONS: readonly {
  readonly key: keyof PlaygroundPermissions;
  readonly label: string;
}[] = [
  { key: 'data', label: 'Data' },
  { key: 'images', label: 'Images' },
  { key: 'links', label: 'Links & downloads' },
];

const TAGS = baseCatalog.tags();

function chunkSource(source: string, mode: ChunkMode): readonly string[] {
  switch (mode) {
    case 'char':
      return [...source];
    case 'word':
      return source.match(/\S+\s*|\s+/g) ?? [];
    case 'line':
      return source.match(/[^\n]*\n|[^\n]+$/g) ?? [];
    case 'random': {
      const chunks: string[] = [];
      for (let start = 0; start < source.length; ) {
        const size = 1 + Math.floor(Math.random() * RANDOM_MAX_CHUNK);
        chunks.push(source.slice(start, start + size));
        start += size;
      }
      return chunks;
    }
  }
}

interface Session {
  readonly renderer: RegionTreeRenderer;
  readonly writer: WireWriter;
  readonly chunks: readonly string[];
  /** False for instant re-renders after a settings change; those don't log completion. */
  readonly announce: boolean;
  index: number;
  finished: boolean;
}

interface LogEntry {
  readonly id: number;
  readonly kind: 'choice' | 'refine' | 'host' | 'error' | 'lifecycle';
  readonly text: string;
}

/**
 * Stream any `.htmd` source through a live `RegionTreeRenderer`, change what
 * the host allows, and watch intents, diagnostics, and partial rendering.
 */
export function KitchenSinkTab(): JSX.Element {
  const [source, setSource] = useState(KITCHEN_SINK_HTMD);
  const [chunkMode, setChunkMode] = useState<ChunkMode>('word');
  const [speedIndex, setSpeedIndex] = useState(1);
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState({ index: 0, total: 0 });
  const [pending, setPending] = useState(false);
  const [offered, setOffered] = useState<ReadonlySet<string>>(() => new Set(TAGS));
  const [permissions, setPermissions] = useState<PlaygroundPermissions>({
    data: true,
    images: true,
    links: true,
  });
  const [limitPreset, setLimitPreset] = useState<LimitPreset>('default');
  const [xray, setXray] = useState(false);
  const [log, setLog] = useState<readonly LogEntry[]>([]);
  const [diagnostics, setDiagnostics] = useState<readonly HtmdDiagnostic[]>([]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<Session | undefined>(undefined);
  const logIdRef = useRef(0);
  const deferredSource = useDeferredValue(source);

  const host: HtmdHost = useMemo(
    () =>
      createPlaygroundHost(
        baseCatalog.without(...TAGS.filter((tag) => !offered.has(tag))),
        permissions,
      ),
    [offered, permissions],
  );
  const limits = LIMITS[limitPreset].limits;

  // Callbacks read the latest settings without restarting the stream.
  const latest = useRef({ host, limits, source: deferredSource, chunkMode });
  latest.current = { host, limits, source: deferredSource, chunkMode };

  const addLog = useCallback((kind: LogEntry['kind'], text: string): void => {
    logIdRef.current += 1;
    const entry: LogEntry = { id: logIdRef.current, kind, text };
    setLog((previous) => [entry, ...previous].slice(0, LOG_SIZE));
  }, []);

  const syncView = useCallback((session: Session): void => {
    setProgress({ index: session.index, total: session.chunks.length });
    setPending(containerRef.current?.querySelector('[data-htmd-pending]') !== null);
  }, []);

  const startSession = useCallback(
    (announce = true): Session | undefined => {
      const container = containerRef.current;
      if (container === null) {
        return undefined;
      }
      const settings = latest.current;
      container.replaceChildren();
      const renderer = new RegionTreeRenderer(container, {
        host: settings.host,
        limits: settings.limits,
      });
      renderer.addEventListener(RendererEvents.RegionUpdated, (event) => {
        const detail = (event as CustomEvent<RegionUpdatedDetail>).detail;
        if (detail.id === REGION) {
          setDiagnostics(detail.diagnostics);
        }
      });
      renderer.addEventListener(RendererEvents.Error, (event) => {
        const detail = (event as CustomEvent<RendererErrorDetail>).detail;
        addLog('error', `${detail.recoverable ? 'Recoverable' : 'Fatal'}: ${detail.message}`);
        if (!detail.recoverable) {
          setStatus('failed');
        }
      });
      const writer = new WireWriter(DOC_ID);
      renderer.apply(writer.open());
      renderer.apply(writer.region(REGION, { tag: 'article' }));
      const session: Session = {
        renderer,
        writer,
        chunks: chunkSource(settings.source, settings.chunkMode),
        announce,
        index: 0,
        finished: false,
      };
      sessionRef.current = session;
      setDiagnostics([]);
      syncView(session);
      return session;
    },
    [addLog, syncView],
  );

  const finish = useCallback(
    (session: Session): void => {
      session.finished = true;
      const done =
        session.renderer.apply(session.writer.done(REGION)) &&
        session.renderer.apply(session.writer.close());
      syncView(session);
      if (done) {
        setStatus('done');
        if (session.announce) {
          addLog('lifecycle', `Document complete after ${session.chunks.length} chunks.`);
        }
      }
    },
    [addLog, syncView],
  );

  /** Streams `chunk` (default: the next chunk). Returns false once the session stops. */
  const send = useCallback(
    (session: Session, chunk?: string): boolean => {
      if (session.finished) {
        return false;
      }
      const text = chunk ?? session.chunks[session.index] ?? '';
      const accepted = session.renderer.apply(session.writer.stream(REGION, text));
      if (!accepted) {
        session.finished = true;
        syncView(session);
        return false;
      }
      session.index = chunk === undefined ? session.index + 1 : session.chunks.length;
      if (session.index >= session.chunks.length) {
        finish(session);
        return false;
      }
      syncView(session);
      return true;
    },
    [finish, syncView],
  );

  const activeSession = useCallback((): Session | undefined => {
    const session = sessionRef.current;
    return session === undefined || session.finished ? startSession() : session;
  }, [startSession]);

  const skipToEnd = useCallback((): void => {
    const session = activeSession();
    if (session === undefined) {
      return;
    }
    setStatus('paused');
    send(session, session.chunks.slice(session.index).join(''));
  }, [activeSession, send]);

  const play = useCallback((): void => {
    if (activeSession() !== undefined) {
      setStatus('playing');
    }
  }, [activeSession]);

  const step = useCallback((): void => {
    const session = activeSession();
    if (session === undefined) {
      return;
    }
    setStatus('paused');
    send(session);
  }, [activeSession, send]);

  const reset = useCallback((): void => {
    startSession();
    setStatus('idle');
  }, [startSession]);

  // First load streams the document; later source, host, or limit changes show the result at once.
  // Comparing inputs (not counting runs) keeps StrictMode's effect replay from skipping autoplay.
  const rendered = useRef<{ source: string; host: HtmdHost; limitPreset: LimitPreset }>(undefined);
  // biome-ignore lint/correctness/useExhaustiveDependencies: restart when what is rendered changes.
  useEffect(() => {
    const previous = rendered.current;
    rendered.current = { source: deferredSource, host, limitPreset };
    if (previous === undefined) {
      play();
    } else if (
      previous.source !== deferredSource ||
      previous.host !== host ||
      previous.limitPreset !== limitPreset
    ) {
      startSession(false);
      skipToEnd();
    }
  }, [deferredSource, host, limitPreset]);

  useEffect(() => {
    if (status !== 'playing') {
      return;
    }
    const timer = window.setInterval(() => {
      const session = sessionRef.current;
      if (session === undefined || !send(session)) {
        window.clearInterval(timer);
        setStatus((current) => (current === 'playing' ? 'paused' : current));
      }
    }, SPEEDS[speedIndex]?.ms ?? 25);
    return () => window.clearInterval(timer);
  }, [status, speedIndex, send]);

  // Intents bubble out of the rendered document; the host answers refine requests.
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }
    const onChoice = (event: Event): void => {
      const detail = (event as CustomEvent<ChoiceDetail>).detail;
      addLog('choice', `choice ${detail.name} = "${detail.value}" from ${detail.region ?? '—'}`);
    };
    const onRefine = (event: Event): void => {
      const detail = (event as CustomEvent<RefineDetail>).detail;
      addLog('refine', `refine ${detail.target}: "${detail.prompt}"`);
      const prompt = event.target as RefinePrompt;
      window.setTimeout(() => {
        prompt.reset(true);
        addLog('host', `Host finished the revision request for ${detail.target}; prompt reset.`);
      }, HOST_ACK_MS);
    };
    container.addEventListener(ComponentEvents.Choice, onChoice);
    container.addEventListener(ComponentEvents.Refine, onRefine);
    return () => {
      container.removeEventListener(ComponentEvents.Choice, onChoice);
      container.removeEventListener(ComponentEvents.Refine, onRefine);
    };
  }, [addLog]);

  const toggleComponent = (tag: string): void => {
    const offering = !offered.has(tag);
    addLog('host', `Host ${offering ? 'offers' : 'no longer offers'} <${tag}>; re-rendered.`);
    setOffered((previous) => {
      const next = new Set(previous);
      if (!next.delete(tag)) {
        next.add(tag);
      }
      return next;
    });
  };

  const togglePermission = (key: keyof PlaygroundPermissions, label: string): void => {
    addLog('host', `${label} ${permissions[key] ? 'refused' : 'allowed'}; re-rendered.`);
    setPermissions((previous) => ({ ...previous, [key]: !previous[key] }));
  };

  return (
    <>
      <section className="pane">
        <h2>Stream</h2>
        <div className="controls">
          <button
            type="button"
            className="primary"
            onClick={() => (status === 'playing' ? setStatus('paused') : play())}
          >
            {status === 'playing' ? 'Pause' : 'Play'}
          </button>
          <button type="button" onClick={step}>
            Step
          </button>
          <button type="button" onClick={skipToEnd}>
            Skip to end
          </button>
          <button type="button" onClick={reset}>
            Reset
          </button>
          <select
            aria-label="Chunking"
            value={chunkMode}
            onChange={(event) => setChunkMode(event.target.value as ChunkMode)}
          >
            {Object.entries(CHUNK_MODES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select
            aria-label="Speed"
            value={speedIndex}
            onChange={(event) => setSpeedIndex(Number(event.target.value))}
          >
            {SPEEDS.map((speed, index) => (
              <option key={speed.label} value={index}>
                {speed.label}
              </option>
            ))}
          </select>
        </div>

        <h2>Host</h2>
        <fieldset className="chips">
          <legend>Components the host offers</legend>
          {TAGS.map((tag) => (
            <label key={tag}>
              <input
                type="checkbox"
                checked={offered.has(tag)}
                onChange={() => toggleComponent(tag)}
              />
              <code>{tag}</code>
            </label>
          ))}
        </fieldset>
        <fieldset className="chips">
          <legend>Permissions</legend>
          {PERMISSIONS.map(({ key, label }) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={permissions[key]}
                onChange={() => togglePermission(key, label)}
              />
              {label}
            </label>
          ))}
        </fieldset>
        <div className="controls">
          <label className="inline-field">
            Limits
            <select
              value={limitPreset}
              onChange={(event) => {
                const preset = event.target.value as LimitPreset;
                addLog('host', `Limits: ${LIMITS[preset].label}; re-rendered.`);
                setLimitPreset(preset);
              }}
            >
              {Object.entries(LIMITS).map(([value, preset]) => (
                <option key={value} value={value}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>
          <label className="inline-field">
            <input type="checkbox" checked={xray} onChange={() => setXray(!xray)} />
            X-ray
          </label>
        </div>

        <details className="try">
          <summary>Things to try</summary>
          <ul>
            <li>Pick a choice and type in the revision box while it streams. Both survive.</li>
            <li>Submit a revision: the intent is logged, and the host resets the prompt.</li>
            <li>
              Untick <code>data-table</code>: a component the host doesn't offer falls back to text.
            </li>
            <li>
              Untick Data, Images, or Links: tables block, images show alt text, links vanish.
            </li>
            <li>Stream by character at Crawl and watch bold, links, and tables arrive.</li>
            <li>Turn on X-ray to see regions, pending state, placeholders, and fallbacks.</li>
            <li>Pick Tight limits: the stream is rejected and the document closes.</li>
            <li>Edit the source; the render updates. Press Play to stream your edit.</li>
          </ul>
        </details>

        <h2>Source</h2>
        <textarea
          className="source sink-source"
          aria-label="Source"
          value={source}
          onChange={(event) => setSource(event.target.value)}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
      </section>

      <section className="pane">
        <h2>Render</h2>
        <div className="status-line" aria-live="polite">
          <span data-status={status}>{status}</span>
          <span className="frame">
            chunk {progress.index} / {progress.total}
          </span>
          {pending ? <span className="badge">pending syntax</span> : null}
        </div>
        <div className="render sink-render" data-xray={xray} ref={containerRef} />

        <div className="sink-panels">
          <div className="event-log">
            <h3>Intents and events</h3>
            {log.length === 0 ? (
              <p className="empty">Choose an option or submit a revision.</p>
            ) : (
              <ol>
                {log.map((entry) => (
                  <li key={entry.id} data-kind={entry.kind}>
                    {entry.text}
                  </li>
                ))}
              </ol>
            )}
          </div>
          <div className="event-log">
            <h3>Diagnostics ({diagnostics.length})</h3>
            {diagnostics.length === 0 ? (
              <p className="empty">None.</p>
            ) : (
              <ol>
                {diagnostics.map((diagnostic) => (
                  <li
                    key={`${diagnostic.start}-${diagnostic.code}-${diagnostic.message}`}
                    data-kind={diagnostic.severity === 'error' ? 'error' : 'warning'}
                  >
                    <code>{diagnostic.code}</code> {diagnostic.message}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
