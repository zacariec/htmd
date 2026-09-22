# `@zacariec/htmd-react`

React adapter for HTMD. Requires React 18 or newer.

```tsx
import { HtmdDoc, useHtmdStream } from '@zacariec/htmd-react';
import type { HtmdStreamSource } from '@zacariec/htmd-react';

export function Message() {
  return <HtmdDoc source={'# Hello\n\nStreaming-first Markdown.'} />;
}

export function Live({ source }: { source: HtmdStreamSource }) {
  const { ref, status, error } = useHtmdStream(source);
  return <section><div ref={ref} /><p>{status}{error ? `: ${error}` : ''}</p></section>;
}
```

`HtmdDoc` accepts `source` and optional `onDiagnostics`. Both entry points register the built-in custom elements on mount.

Keep `source` stable across renders. Accepted stream sources are `Iterable<WireEvent>`, `AsyncIterable<WireEvent>`, `ReadableStream<WireEvent>`, and `EventSource`. Fetch byte streams require decoding/framing first. SSE messages carry one JSON-encoded wire event each.

- `idle`: no event has arrived; an empty finite source remains idle.
- `streaming`: events are being consumed.
- `done`: the renderer accepted `doc-done`, including on an SSE connection that remains open.
- `error`: transport failure, fatal renderer error, or a nonempty finite source ending without `doc-done`.

Completion, failure, unmount, and source replacement stop further event application. Owned stream readers are cancelled/released and unfinished async iterators receive `return()`. SSE listeners are removed, but the hook does not close caller-owned EventSource connections. Source replacement clears prior document/error state. Automatic reconnect and restoration of event history belong to the host application.

Part of [HTMD](https://github.com/zacariec/htmd). Install with `npm install @zacariec/htmd-react@alpha`.
