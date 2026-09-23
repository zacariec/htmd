import { defaultHost } from '@htmdjs/contracts';
import type { HtmdDiagnostic, HtmdHost } from '@htmdjs/contracts';
import { renderHtmdSource, renderHtmdToString } from '@htmdjs/renderer';
import type { JSX } from 'react';
import { type HTMLAttributes, useEffect, useRef, useState } from 'react';

import { ensureHtmdElementsRegistered } from './register.js';

export interface HtmdDocProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'dangerouslySetInnerHTML'> {
  /** The `.htmd` source to render. */
  readonly source: string;
  /**
   * Which components may render and what they may load. Defaults to
   * `defaultHost`. Keep its identity stable: a new host re-renders the document.
   */
  readonly host?: HtmdHost;
  /** Called with parser and contract diagnostics on every client render pass. */
  readonly onDiagnostics?: (diagnostics: ReadonlyArray<HtmdDiagnostic>) => void;
}

/**
 * `<HtmdDoc>` — renders a static `.htmd` string into a Lit tree mounted in the
 * React tree. Re-renders when `source` or `host` changes.
 *
 * On the server (and in the first client render) the container holds the
 * `renderHtmdToString` markup, so server-rendered pages show the document
 * before hydration. After mount the materializer owns the container's
 * interior; React never touches it again because the initial HTML is
 * computed once and its value never changes.
 */
export function HtmdDoc(props: HtmdDocProps): JSX.Element {
  const { source, host = defaultHost, onDiagnostics, ...rest } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [initialHtml] = useState(() => ({ __html: renderHtmdToString(source, { host }).html }));

  useEffect(() => {
    ensureHtmdElementsRegistered();
    const container = containerRef.current;
    if (container === null) {
      return;
    }
    const result = renderHtmdSource(container, source, { host });
    onDiagnostics?.(result.diagnostics);
  }, [source, host, onDiagnostics]);

  return (
    <div
      ref={containerRef}
      {...rest}
      // Renderer output, not source: Markdown raw HTML is escaped and attribute values are escaped.
      // biome-ignore lint/security/noDangerouslySetInnerHtml: server-rendered initial markup for hydration.
      dangerouslySetInnerHTML={initialHtml}
      suppressHydrationWarning
    />
  );
}
