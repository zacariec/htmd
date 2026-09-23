# `@htmdjs/core`

A streaming-first document protocol and runtime for Markdown and interactive components. HTMD defines how incomplete content renders, how addressed sections change, and how interaction survives updates.

```sh
npm install @htmdjs/core@alpha
```

```ts
import { RegionTreeRenderer, baseCatalog, createHost, readWireEvents, registerHtmdElements } from '@htmdjs/core';

registerHtmdElements();
const host = createHost({ components: baseCatalog });
const container = document.querySelector('#answer');
if (!container) throw new Error('Missing answer container');
const renderer = new RegionTreeRenderer(container, { host });
for await (const event of readWireEvents(fetch('/api/chat', { method: 'POST', body }))) {
  renderer.apply(event);
}
```

On the server, `new Response(toEventStream(streamText(tokens)), { headers: WIRE_EVENT_STREAM_HEADERS })` produces that body, and `modelInstructions(host.components)` produces a system prompt that lists only the components the host offers.

The browser export condition registers the base elements automatically; explicit registration is idempotent. Node/SSR imports are safe and do not register elements. DOM rendering requires a browser; `renderHtmdToString(source, { host })` renders a static document to HTML without one.

This meta package re-exports the public APIs of the other packages:

- `@htmdjs/contracts`: component contracts, catalogs, hosts, intents, payload schemas, validation, `modelInstructions`, and `captureInteractionState` / `restoreInteractionState`.
- `@htmdjs/parser`: `Parser`, diagnostics, and `DEFAULT_RAW_TEXT_TAGS`.
- `@htmdjs/wire`: event schemas, `streamText`, `WireWriter`, and HTTP transport (`toEventStream`, `readWireEvents`, `WIRE_EVENT_STREAM_HEADERS`).
- `@htmdjs/elements`: the base components, `registerHtmdElements`, and `completeRefine`.
- `@htmdjs/renderer`: `renderHtmdSource`, `renderHtmdToString`, `materializeInto`, `RegionTreeRenderer`, `RenderLimits`, and `DEFAULT_RENDER_LIMITS`.

React is optional: install `@htmdjs/react@alpha` separately.

The host decides which components a document may use, which URLs they may load per purpose, and how component data is loaded; data URLs are never authorized by default. Streaming appends preserve existing component interaction state; incomplete custom syntax is buffered; `complete`-policy components show a `data-htmd-deferred` placeholder until their closing tag arrives; the unfinished end of streaming Markdown renders provisionally, completing unambiguous syntax and withholding ambiguous syntax, so readers never see markers that later vanish and half-written links are never clickable. Finished Markdown blocks render to DOM once and are never touched again; only the unfinished end of a region re-renders, and the result equals rendering the whole document with ordinary CommonMark + GFM. HTMD's own parser still re-parses the region text on every chunk, so it is not a fully incremental Markdown parser, and a single very large block still re-renders per chunk.

Individual packages: `@htmdjs/contracts`, `@htmdjs/parser`, `@htmdjs/wire`, `@htmdjs/elements`, `@htmdjs/renderer`, and `@htmdjs/react`.

The unrelated unscoped npm package `htmd` is not this project. Full specification and examples: <https://github.com/zacariec/htmd>.
