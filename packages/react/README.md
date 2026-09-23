# `@htmdjs/react`

React adapter for HTMD. Requires React 18 or newer.

```tsx
import { baseCatalog, createHost } from '@htmdjs/contracts';
import { HtmdDoc, useHtmdStream } from '@htmdjs/react';
import { streamText } from '@htmdjs/wire';
import { useMemo } from 'react';

// Module scope keeps the host identity stable.
const host = createHost({ components: baseCatalog.without('data-table') });

export function Message() {
  return <HtmdDoc source={'# Hello\n\nStreaming-first Markdown.'} host={host} />;
}

// Stream model output (any AsyncIterable<string>) straight into the page.
export function Live({ tokens }: { tokens: AsyncIterable<string> }) {
  const source = useMemo(() => streamText(tokens), [tokens]);
  const { ref, status, error } = useHtmdStream(source, { host, limits: { maxRegions: 200 } });
  return <section><div ref={ref} /><p>{status}{error ? `: ${error}` : ''}</p></section>;
}
```

`HtmdDoc` accepts `source`, optional `host`, and optional `onDiagnostics(diagnostics: ReadonlyArray<HtmdDiagnostic>)`, which receives parser and contract diagnostics. `useHtmdStream(source, options?)` accepts `{ host?, limits? }` (`Partial<RenderLimits>` from `@htmdjs/renderer`). Without a host, `defaultHost` from `@htmdjs/contracts` applies. Both entry points register the built-in custom elements on mount; only components in the host catalog render.

Keep `source` and `host` identities stable across renders; memoize `streamText(...)` so a re-render does not restart the stream. One-shot sources such as `streamText` work under React StrictMode, and unmounting closes the underlying text source. Accepted stream sources are `Iterable<WireEvent>`, `AsyncIterable<WireEvent>`, `ReadableStream<WireEvent>`, and `EventSource`. Fetch byte streams require decoding/framing first. SSE messages carry one JSON-encoded wire event each.

- `idle`: no event has arrived; an empty finite source remains idle.
- `streaming`: events are being consumed.
- `done`: the renderer accepted `doc-done`, including on an SSE connection that remains open.
- `error`: transport failure, fatal renderer error (including an exceeded render limit), or a nonempty finite source ending without `doc-done`.

Completion, failure, unmount, and source replacement stop further event application. Owned stream readers are cancelled/released and unfinished async iterators receive `return()`. SSE listeners are removed, but the hook does not close caller-owned EventSource connections. Source replacement clears prior document/error state. Automatic reconnect and restoration of event history belong to the host application.

Part of [HTMD](https://github.com/zacariec/htmd). Install with `npm install @htmdjs/react@alpha`.
