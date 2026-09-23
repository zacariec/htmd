# HTMD

A streaming-first document protocol and runtime for Markdown and interactive components. HTMD defines how incomplete content renders, how addressed sections change, and how interaction survives updates.

Markdown carries the prose. A host-controlled library of components carries structure and interaction, and every component has an executable contract: which attributes it accepts, whether it renders while partial, which state the user owns, which intents it emits, and which effects the host must authorize. Documents stream as region-addressed events, so sections fill, complete, and get revised independently. HTMD is not a replacement for CommonMark or GFM.

## Install the alpha

```sh
npm install @htmdjs/core@alpha
# Optional React adapter:
npm install @htmdjs/react@alpha
```

The packages belong to the `@htmdjs` organization. The unrelated unscoped npm package `htmd` is not this project.

Importing the meta package with the browser export condition registers the base custom elements. Node/SSR imports do not register elements; DOM rendering still requires a browser, and [`renderHtmdToString`](#server-rendering) renders without one.

## Stream into a document

`streamText` turns streamed text, such as model output, into a complete wire document:

```ts
import { RegionTreeRenderer, baseCatalog, createHost, registerHtmdElements, streamText } from '@htmdjs/core';

registerHtmdElements();
const host = createHost({ components: baseCatalog });
const container = document.querySelector('#answer');
if (!container) throw new Error('Missing answer container');
const renderer = new RegionTreeRenderer(container, { host });

// modelTokens: any AsyncIterable<string> or Iterable<string>.
for await (const event of streamText(modelTokens, { region: '$.answer' })) {
  renderer.apply(event);
}
```

It opens the document, declares the region, sends each non-empty chunk, then finalizes the region and closes the document. If the text source throws, it sends a fatal `error` event and rethrows. If the consumer stops early, the text source is closed too, so generation stops.

For documents with several regions, `WireWriter` numbers events and validates region ids:

```ts
import { WireWriter } from '@htmdjs/core';

const doc = new WireWriter('answer');
send(doc.open());
send(doc.region('$.summary'));
send(doc.region('$.details', { tag: 'section' }));
send(doc.stream('$.details', 'Loading the breakdown…'));
send(doc.stream('$.summary', 'Revenue grew **12%**.'));
send(doc.done('$.summary'));
send(doc.close());
```

`close()` or a fatal `error()` ends the document; later calls throw. Producers send structured events over an ordered transport.

## Over HTTP

`EventSource` cannot POST a prompt or send auth headers, so HTMD streams over `fetch`. On the server, `toEventStream` encodes events as an SSE body (or JSONL with `{ format: 'jsonl' }`):

```ts
import { WIRE_EVENT_STREAM_HEADERS, streamText, toEventStream } from '@htmdjs/core';

export async function POST(request: Request): Promise<Response> {
  const tokens = model.stream(await request.json()); // AsyncIterable<string>
  return new Response(toEventStream(streamText(tokens)), { headers: WIRE_EVENT_STREAM_HEADERS });
}
```

On the client, `readWireEvents(response, { format?, signal? })` accepts a `Response`, a promise of one (such as `fetch(...)`), or a byte stream, detects SSE or JSONL framing, and yields validated events:

```tsx
import { readWireEvents } from '@htmdjs/core';
import { useHtmdStream } from '@htmdjs/react';

const events = useMemo(
  () => readWireEvents(fetch('/api/chat', { method: 'POST', headers: { authorization }, body })),
  [body],
);
const { ref, status } = useHtmdStream(events, { host });
```

The body is pulled one event at a time, so a slow client slows generation instead of buffering it. Stopping early (unmount, `signal` abort, or an error) cancels the fetch body; cancelling the response stream on the server closes the event source, and `streamText` then closes the model stream. A response that is not ok throws `HTTP <status> <statusText>`; a malformed message throws with its message number.

## The host decides

A host is `{ components, authorizeUrl, loadData }`, built with `createHost`:

- **Components:** only components in the host's `ComponentCatalog` render. Registering a custom element globally is not permission; anything else renders as text. Narrow the base set with `baseCatalog.without(...)` or add contracts with `with(...)`.
- **URLs:** every URL a component loads or exposes is authorized per purpose (`data`, `image`, `link`, `download`). The default policy allows same-origin images, links, and downloads, and **never** authorizes data — a model-written URL is not permission to fetch it.
- **Data:** `loadData({ url, component, element, signal })` returns a complete payload or an async iterable of batches. `<data-table>` renders validated `TableBatch` rows progressively. Without a loader, authorized data URLs are fetched as JSON.
- **Model instructions:** `modelInstructions(host.components, { examples? })` generates system-prompt Markdown from the same catalog. Components the host does not offer, and children or examples that would not validate against it, are left out, so the model only sees what will render. [`AI_SPEC.md`](./AI_SPEC.md) is the full reference for the base set.

```ts
import { baseCatalog, createHost, modelInstructions } from '@htmdjs/core';

const host = createHost({
  components: baseCatalog,
  authorizeUrl: ({ url, purpose, element }) =>
    url.origin === new URL(element.ownerDocument.baseURI).origin &&
    (purpose !== 'data' || url.pathname.startsWith('/api/')),
  loadData: async ({ url, signal }) => (await fetch(url, { signal })).json(),
});
const system = modelInstructions(host.components);
```

With no host, `defaultHost` applies: the base catalog, the default URL policy, and no loader, so `<data-table>` is blocked.

## What streaming guarantees

- **Partial syntax:** incomplete custom-element tags are buffered rather than flashed as literal markup. `progressive` components (messages, choice groups, code) render available content while open; `complete` components (choice items, images, files, tables, refine prompts, fragments) hold their position with a `<div data-htmd-deferred="{tag}" aria-busy="true">` placeholder (a styleable skeleton hook) until their closing tag arrives, so partial content is never interactive.
- **Partial Markdown:** the unfinished end of the stream renders as provisional Markdown. Unambiguous syntax is completed (`Revenue grew **12` shows bold `12`; `**Hello*` shows bold `Hello`), ambiguous syntax is withheld (a line of only `-`, `1.`, `>`, `#`, `|`, or backticks; a table header before its delimiter row; an unresolved `[`), and nothing partial becomes interactive (a link whose destination is still streaming shows its label as plain text; a trailing bare URL links once whitespace ends it). Readers never see syntax that later vanishes. `data-htmd-pending` marks a region with known incomplete custom syntax or a provisional Markdown frontier.
- **Incremental rendering:** finished Markdown blocks render once; only the unfinished end of a region renders again (see [Performance](#performance)).
- **Contracts:** invalid components render a neutral text fallback instead of a half-working widget. Unknown attributes are dropped. Diagnostics explain each fallback and dropped attribute or child.
- **Stable interaction:** appending prose preserves unchanged component instances, selections, loaded data, and focused refinement drafts. User-owned (`initial`) attributes are never overwritten by later source. Explicit `region-replace` deliberately replaces the region body and its descendants.
- **Targeted updates:** regions can fill independently. Replacement follows actual parentage, including explicit parents whose IDs have a different prefix.
- **Attributed intents:** `choice` and `refine` events carry the region they came from.
- **Completion:** `region-done` finalizes and seals a region and its subtree. `region-replace` can reopen it while its ancestors and document remain open. `doc-done` finalizes all regions and closes the document. Call `reset()` before starting another document.
- **Replay:** previously accepted sequence numbers are ignored. Rejected events do not consume a sequence number. The producer must supply ordered events; this is not an out-of-order network-delivery repair mechanism.
- **Bounded:** documents are limited to 1000 regions, region depth 32, 1 MB per region, and 4 MB per document by default; custom elements nest at most 64 deep.
- **Interruption:** the React adapter distinguishes a completed document from a transport ending before `doc-done`. Fatal errors stop consumption. Caller-owned EventSource connections are not closed by the adapter.

The renderer's streaming test suite streams a corpus of 9 documents character by character (about 1,400 prefixes) and asserts: no syntax flashes (the visible text of every prefix is a prefix of the final visible text), no retraction (visible text only grows), and no premature links (every link or image shown mid-stream already has its final destination). The same corpus without repair produced 436 flashing prefixes, 46 retractions, and 97 premature links. Intraword delimiters (`2*3`, `snake_case`) stay literal. Finalization (`region-done`, `doc-done`, and every static render) uses ordinary CommonMark + GFM semantics; the provisional view never affects the final document. Incomplete custom syntax is preserved on finalization with diagnostics.

Producers can check a document before sending it with `validateNodes`, which applies the same contract rules as the renderer.

## Performance

Each finished top-level Markdown block is converted to HTML and DOM once; only the unfinished end of the region renders again, and finished blocks' DOM is never touched again. Block boundaries come from micromark's CommonMark + GFM tokenizer. A block counts as finished only once the next block has started on a complete line, because a partial last line can still change meaning (`#` versus `#tag`, a fence gaining an info string, indentation still arriving). The output equals rendering the whole document at once: link reference definitions apply across blocks, and a document containing `[^` (GFM footnotes) renders as one block.

Measured in jsdom, streaming one region in 4-character chunks:

| Answer size | Last-chunk cost, before → after | Total, before → after |
|---|---|---|
| 5 KB | 9.3 ms → 0.41 ms | — |
| 20 KB | 61 ms → 0.47 ms | 143 s → 2.1 s |
| 40 KB | did not finish in minutes → 0.68 ms | did not finish → 4.7 s |

In headless Chromium, the playground's 40 KB "Long answer" streamed in random 1–16 character chunks costs 0.2–0.7 ms per chunk from start to finish. The 40 KB "did not finish" row came from an earlier probe that was stopped after several minutes, so no exact before-total exists for it.

HTMD is **not a fully incremental Markdown parser**. Its own parser still re-parses the region text on every chunk (about 0.1 ms at 20 KB) to locate components, and a single very large block (for example one huge code block) still re-renders on every chunk. Unchanged components are reconciled, not reconstructed.

## Server rendering

`renderHtmdToString(source, { host })` from `@htmdjs/renderer` renders a static document to an HTML string without a DOM, so it runs in Node, workers, and edge runtimes. Its output parses to the same DOM `renderHtmdSource` would produce, and it returns the same diagnostics. Components the host allows become their custom-element tags with validated attributes; their shadow content and data loads happen on the client once the elements register. `<HtmdDoc>` uses it to server-render and then hydrate.

## Interaction state

User-owned component state survives streaming on its own. To carry it across a reload or a re-render of the same source, save and restore it:

```ts
import { captureInteractionState, restoreInteractionState } from '@htmdjs/core';

sessionStorage.setItem('answer', JSON.stringify(captureInteractionState(root)));
// …after rendering the same document again:
restoreInteractionState(root, JSON.parse(sessionStorage.getItem('answer') ?? 'null'));
```

Snapshots are JSON-serializable and keyed by region, tag, and ordinal, and the walk includes open shadow roots. `<choice-group>` saves its selected value and `<refine-prompt>` its draft. Restoring does not emit intents.

To end a refinement round trip, call `completeRefine(event, { clearInput? })` from `@htmdjs/elements` with the `refine` event; it finds the originating prompt even after an asynchronous round trip, so hosts no longer cast `event.target`.

## Long conversations

Finished blocks are real DOM, so a long chat history is ordinary page content. Let the browser skip layout and paint for offscreen messages with CSS:

```css
[data-htmd-region][data-htmd-done] {
  content-visibility: auto;
  contain-intrinsic-size: auto 20em;
}
```

Offscreen messages keep their component state, remain searchable with find-in-page, and stay in the accessibility tree. The renderer sets `data-htmd-done` on a region once it is finalized, so the rule applies only to finished regions, never to the one still streaming.

HTMD does not ship a FlashList-style virtualizer. Unmounting offscreen messages would destroy component state (selected choices, refinement drafts, loaded tables), and component heights are not known before they mount. Hosts that virtualize anyway can save and restore state around unmounts with `captureInteractionState` / `restoreInteractionState`. For text-only messages, [Pretext](https://github.com/chenglou/pretext) measures exact text heights without rendering.

## React

```tsx
import { baseCatalog, createHost, streamText } from '@htmdjs/core';
import { HtmdDoc, useHtmdStream } from '@htmdjs/react';
import { useMemo } from 'react';

const host = createHost({ components: baseCatalog });

export function StaticMessage() {
  return <HtmdDoc source={'# Hello\n\n**Markdown**, with optional components.'} host={host} />;
}

export function StreamedMessage({ tokens }: { tokens: AsyncIterable<string> }) {
  const source = useMemo(() => streamText(tokens), [tokens]);
  const { ref, status, error } = useHtmdStream(source, { host });
  return <section><div ref={ref} /><p>{status}{error ? `: ${error}` : ''}</p></section>;
}
```

`HtmdDoc` server-renders its document and hydrates on the client; it accepts ordinary `<div>` props except `children` and `dangerouslySetInnerHTML`. Keep `source` and `host` stable across renders (`useMemo` for `streamText` or `readWireEvents`). Supported sources: synchronous/async iterables of events, `ReadableStream<WireEvent>`, and `EventSource`. `done` means an accepted `doc-done`, not simply EOF. An empty finite source stays `idle`; a nonempty truncated source becomes `error`. One-shot sources such as `streamText` work under React StrictMode.

## Packages

| Package | Purpose |
|---|---|
| [`@htmdjs/core`](./packages/htmd) | Meta package: contracts, parser, wire protocol, components, and renderer. |
| [`@htmdjs/contracts`](./packages/contracts) | Component contracts, catalogs, host capabilities, intents, payload schemas, validation, model instructions, and interaction state. |
| [`@htmdjs/parser`](./packages/parser) | Dependency-free source parser, streaming/pending state, diagnostics, and decoded attributes. |
| [`@htmdjs/wire`](./packages/wire) | Zod-validated event shapes, producer helpers (`streamText`, `WireWriter`), and HTTP transport (`toEventStream`, `readWireEvents`). |
| [`@htmdjs/elements`](./packages/elements) | Nine Lit components for choices, refinement, files, images, tables, code, messages, and structured fragments. |
| [`@htmdjs/renderer`](./packages/renderer) | Contract-enforcing incremental rendering, region streaming, and DOM-free server rendering. |
| [`@htmdjs/react`](./packages/react) | Server-renderable document component and stream lifecycle hook. |

## Playground and development

Node 22 or newer and the pinned pnpm version are required.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @htmd-examples/playground dev
```

Open `http://localhost:5173/`, choose **Streaming**, and use the partial-syntax/interaction example. Select **Wire chunks** and **Manual**, step to the choice and refinement controls, interact, then keep stepping. Character-by-character playback is also available. The playground host serves the sample `<data-table>` from an in-page loader in progressive batches; its image and download URLs illustrate host-provided resources that the example does not serve.

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter './examples/*' run build
```

## Security and alpha scope

Raw HTML is escaped; inline event-handler attributes are refused. Components authorize every URL through the host, and data URLs require explicit host permission. Register only trusted custom elements and list only trusted contracts in a catalog: component implementations decide what attributes do, and a hyphenated tag name is not a sandbox.

This alpha does not persist server event logs, reconnect a transport automatically, or make external data URLs immutable. Event replay reproduces document instructions, not user interaction state (save that separately with `captureInteractionState`) or a historical snapshot of changing remote resources.

Bench's entity-decoding fix and its parser/renderer regression coverage are included. Bench-specific editor schemas, HTML-import normalization, and application authorization remain in Bench.

- [Full specification](./spec/htmd-spec.md)
- [Model-facing instructions](./AI_SPEC.md)
- Release notes: [contracts and host capabilities](./.changeset/contracts-and-host-capabilities.md), [producer helpers](./.changeset/wire-producer-helpers.md), [streaming performance and transport](./.changeset/streaming-performance-and-transport.md)

## Licence

MIT.
