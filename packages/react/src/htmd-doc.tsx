import { defaultHost } from '@htmdjs/contracts';
import type { HtmdDiagnostic, HtmdHost } from '@htmdjs/contracts';
import { renderHtmdSource } from '@htmdjs/renderer';
import type { JSX } from 'react';
import { type HTMLAttributes, useEffect, useRef } from 'react';

import { ensureHtmdElementsRegistered } from './register.js';

export interface HtmdDocProps extends HTMLAttributes<HTMLDivElement> {
  /** The `.htmd` source to render. */
  readonly source: string;
  /**
   * Which components may render and what they may load. Defaults to
   * `defaultHost`. Keep its identity stable: a new host re-renders the document.
   */
  readonly host?: HtmdHost;
  /** Called with parser and contract diagnostics on every render pass. */
  readonly onDiagnostics?: (diagnostics: ReadonlyArray<HtmdDiagnostic>) => void;
}

/**
 * `<HtmdDoc>` — renders a static `.htmd` string into a Lit tree mounted in the
 * React tree. Re-renders when `source` or `host` changes.
 *
 * The container `<div>` is React-managed; its interior DOM is
 * materializer-managed. React never sees the internal children.
 */
export function HtmdDoc(props: HtmdDocProps): JSX.Element {
  const { source, host = defaultHost, onDiagnostics, ...rest } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    ensureHtmdElementsRegistered();
    const container = containerRef.current;
    if (container === null) {
      return;
    }
    const result = renderHtmdSource(container, source, { host });
    onDiagnostics?.(result.diagnostics);
  }, [source, host, onDiagnostics]);

  return <div ref={containerRef} {...rest} />;
}
