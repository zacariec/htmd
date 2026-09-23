---
'@htmdjs/wire': minor
'@htmdjs/core': minor
'@htmdjs/renderer': patch
---

Producer helpers for streaming text into HTMD.

- `streamText(source, options?)` turns an `AsyncIterable<string>` or `Iterable<string>` (for example, model output) into a complete wire document: `doc-open`, a region, one `stream` per non-empty chunk, `region-done`, and `doc-done`. A failing source yields a fatal `error` event and rethrows; stopping early closes the source; an invalid region id rejects before any event.
- `WireWriter` builds multi-region documents: it numbers events, validates region ids, and refuses events after `close()` or a fatal `error()`.
- `SCHEMA_VERSION` exports the wire version; the renderer now checks `doc-open` against it instead of a duplicated literal.
- `@htmdjs/core` re-exports the helpers and their option types.
