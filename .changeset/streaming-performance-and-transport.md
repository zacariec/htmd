---
'@htmdjs/core': minor
'@htmdjs/contracts': minor
'@htmdjs/parser': minor
'@htmdjs/elements': minor
'@htmdjs/wire': minor
'@htmdjs/renderer': minor
'@htmdjs/react': minor
---

Incremental Markdown rendering, HTTP transport, server rendering, model instructions, and interaction state.

**Changes**

- `HtmdDocProps` now accepts ordinary `<div>` attributes but omits `children` and `dangerouslySetInnerHTML`: the renderer owns the container's interior.

**Additions**

- Incremental Markdown rendering (`@htmdjs/renderer`). Each finished top-level Markdown block renders to HTML and DOM once and is never touched again; only the unfinished end of a region re-renders. Block boundaries come from micromark's CommonMark + GFM tokenizer, and a block finishes only once the next block starts on a complete line. The output equals rendering the whole document: link reference definitions apply across blocks, and documents containing `[^` (GFM footnotes) render as one block. Measured in jsdom with 4-character chunks in one region, the last chunk of a 20 KB answer drops from 61 ms to 0.47 ms (total 143 s to 2.1 s), a 40 KB answer that previously did not finish in minutes now streams in 4.7 s (0.68 ms last chunk), and a 5 KB answer drops from 9.3 ms to 0.41 ms per last chunk. HTMD's parser still re-parses the region text per chunk (about 0.1 ms at 20 KB), and a single very large block still re-renders per chunk.
- HTTP transport (`@htmdjs/wire`): `readWireEvents(response | Promise<Response> | ReadableStream<Uint8Array>, { format?: 'auto' | 'sse' | 'jsonl', signal? })` yields validated events from a `fetch` response, so requests can POST and send auth headers; `toEventStream(events, { format?: 'sse' | 'jsonl' })` encodes events as a `ReadableStream<Uint8Array>` body; `WIRE_EVENT_STREAM_HEADERS` supplies SSE response headers. Stopping early cancels the fetch body, and cancelling the response stream closes the event source (so `streamText` closes the model stream).
- Server rendering: `renderHtmdToString(source, { host })` (`@htmdjs/renderer`) renders a static document to HTML without a DOM; the output parses to the same DOM as `renderHtmdSource`. `HtmdDoc` server-renders and hydrates; component shadow content and data loads happen on the client after elements register.
- `modelInstructions(catalog, { examples? })` (`@htmdjs/contracts`) generates system-prompt Markdown from a host's catalog, omitting components, children, and examples the host does not offer.
- `captureInteractionState(root)` / `restoreInteractionState(root, snapshot)` (`@htmdjs/contracts`) save and restore user-owned component state as JSON, keyed by region, tag, and ordinal and including open shadow roots. `<choice-group>` saves its value and `<refine-prompt>` its draft; restoring emits no intents. Components opt in through `StatefulComponent`.
- `completeRefine(event, { clearInput? })` (`@htmdjs/elements`) ends a refinement from its `refine` event, even after an asynchronous round trip, replacing casts of `event.target`.
- `<image-card>` shows its alt text when an authorized image fails to load; changing `src` retries.
- `@htmdjs/core` re-exports all of the above.
- Documentation covers incremental rendering and its limits, HTTP streaming, server rendering, generated model instructions, interaction state, and long conversations (`content-visibility: auto` for finished regions instead of a virtualizer).
