import type { Diagnostic } from '@htmdjs/parser';
import { renderHtmdSource } from '@htmdjs/renderer';
import type { JSX } from 'react';
import { type HTMLAttributes, useEffect, useRef } from 'react';

import { ensureHtmdElementsRegistered } from './register.js';

export interface HtmdDocProps extends HTMLAttributes<HTMLDivElement> {
  /** The `.htmd` source to render. */
  readonly source: string;
  /** Called with parse diagnostics on every render pass. */
  readonly onDiagnostics?: (diagnostics: ReadonlyArray<Diagnostic>) => void;
}

/**
 * `<HtmdDoc>` — renders a static `.htmd` string into a Lit tree mounted in the
 * React tree. Re-renders when `source` changes.
 *
 * The container `<div>` is React-managed; its interior DOM is
 * materializer-managed. React never sees the internal children.
 */
export function HtmdDoc(props: HtmdDocProps): JSX.Element {
  const { source, onDiagnostics, ...rest } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    ensureHtmdElementsRegistered();
    const container = containerRef.current;
    if (container === null) {
      return;
    }
    const result = renderHtmdSource(container, source);
    onDiagnostics?.(result.diagnostics);
  }, [source, onDiagnostics]);

  return <div ref={containerRef} {...rest} />;
}
