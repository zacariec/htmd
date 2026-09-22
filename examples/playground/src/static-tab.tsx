import { HtmdDoc } from '@zacariec/htmd-react';
import type { JSX } from 'react';
import { useCallback, useDeferredValue, useState } from 'react';

interface Diagnostic {
  readonly severity: string;
  readonly code: string;
  readonly message: string;
}
import { SAMPLE_HTMD } from './sample.js';

export function StaticTab(): JSX.Element {
  const [source, setSource] = useState(SAMPLE_HTMD);
  const [diagnostics, setDiagnostics] = useState<ReadonlyArray<Diagnostic>>([]);
  const deferred = useDeferredValue(source);

  const handleDiagnostics = useCallback((next: ReadonlyArray<Diagnostic>): void => {
    setDiagnostics(next);
  }, []);

  return (
    <>
      <section className="pane">
        <h2>Source</h2>
        <textarea
          className="source"
          value={source}
          onChange={(event) => setSource(event.target.value)}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
        {diagnostics.length === 0 ? undefined : (
          <div className="diagnostics">
            <div>
              {diagnostics.length} diagnostic{diagnostics.length === 1 ? '' : 's'}
            </div>
            <ul>
              {diagnostics.map((diagnostic) => (
                <li
                  key={`${diagnostic.code}-${diagnostic.severity}-${diagnostic.message}`}
                  data-severity={diagnostic.severity}
                >
                  [{diagnostic.severity}] {diagnostic.code} — {diagnostic.message}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
      <section className="pane">
        <h2>Render</h2>
        <div className="render">
          <HtmdDoc source={deferred} onDiagnostics={handleDiagnostics} />
        </div>
      </section>
    </>
  );
}
