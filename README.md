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

Importing the meta package with the browser export condition registers the base custom elements. Node/SSR imports do not register elements; DOM rendering still requires a browser.

## Stream into a document

```ts
import { RegionTreeRenderer, baseCatalog, createHost, registerHtmdElements } from '@htmdjs/core';

registerHtmdElements();
const host = createHost({ components: baseCatalog });
const container = document.querySelector('#answer');
if (!container) throw new Error('Missing answer container');
const renderer = new RegionTreeRenderer(container, { host });

renderer.apply({ type: 'doc-open', seq: 0, id: 'answer', schemaVersion: '0.1' });
renderer.apply({ type: 'region', seq: 1, id: '$.body', tag: 'section' });
renderer.apply({ type: 'stream', seq: 2, target: '$.body', chunk: '# Results\n\n' });
renderer.apply({
  type: 'stream', seq: 3, target: '$.body',
  chunk: '<choice-group name="next"><choice-item value="details">Show details</choice-item></choice-group>',
});
renderer.apply({ type: 'stream', seq: 4, target: '$.body', chunk: '\n\nMore prose can arrive without clearing the choice.' });
renderer.apply({ type: 'region-done', seq: 5, id: '$.body' });
renderer.apply({ type: 'doc-done', seq: 6, id: 'answer' });
```

Producers send structured events over an ordered transport. A `ReadableStream<WireEvent>` is a stream of decoded events, not raw HTTP bytes; decode SSE/JSONL framing before passing a Fetch response stream to the adapter.

## The host decides

A host is `{ components, authorizeUrl, loadData }`, built with `createHost`:

- **Components:** only components in the host's `ComponentCatalog` render. Registering a custom element globally is not permission; anything else renders as text. Narrow the base set with `baseCatalog.without(...)` or add contracts with `with(...)`.
- **URLs:** every URL a component loads or exposes is authorized per purpose (`data`, `image`, `link`, `download`). The default policy allows same-origin images, links, and downloads, and **never** authorizes data — a model-written URL is not permission to fetch it.
- **Data:** `loadData({ url, component, element, signal })` returns a complete payload or an async iterable of batches. `<data-table>` renders validated `TableBatch` rows progressively. Without a loader, authorized data URLs are fetched as JSON.

```ts
import { baseCatalog, createHost } from '@htmdjs/core';

const host = createHost({
  components: baseCatalog,
  authorizeUrl: ({ url, purpose, element }) =>
    url.origin === new URL(element.ownerDocument.baseURI).origin &&
    (purpose !== 'data' || url.pathname.startsWith('/api/')),
  loadData: async ({ url, signal }) => (await fetch(url, { signal })).json(),
});
```

With no host, `defaultHost` applies: the base catalog, the default URL policy, and no loader, so `<data-table>` is blocked.

## What streaming guarantees

- **Partial syntax:** incomplete custom-element tags are buffered rather than flashed as literal markup. `progressive` components (messages, choice groups, code) render available content while open; `complete` components (choice items, images, files, tables, refine prompts, fragments) hold their position with a `<div data-htmd-deferred="{tag}" aria-busy="true">` placeholder (a styleable skeleton hook) until their closing tag arrives, so partial content is never interactive.
- **Partial Markdown:** the unfinished end of the stream renders as provisional Markdown. Unambiguous syntax is completed (`Revenue grew **12` shows bold `12`; `**Hello*` shows bold `Hello`), ambiguous syntax is withheld (a line of only `-`, `1.`, `>`, `#`, `|`, or backticks; a table header before its delimiter row; an unresolved `[`), and nothing partial becomes interactive (a link whose destination is still streaming shows its label as plain text; a trailing bare URL links once whitespace ends it). Readers never see syntax that later vanishes. `data-htmd-pending` marks a region with known incomplete custom syntax or a provisional Markdown frontier.
- **Contracts:** invalid components render a neutral text fallback instead of a half-working widget. Unknown attributes are dropped. Diagnostics explain each fallback and dropped attribute or child.
- **Stable interaction:** appending prose preserves unchanged component instances, selections, loaded data, and focused refinement drafts. User-owned (`initial`) attributes are never overwritten by later source. Explicit `region-replace` deliberately replaces the region body and its descendants.
- **Targeted updates:** regions can fill independently. Replacement follows actual parentage, including explicit parents whose IDs have a different prefix.
- **Attributed intents:** `choice` and `refine` events carry the region they came from.
- **Completion:** `region-done` finalizes and seals a region and its subtree. `region-replace` can reopen it while its ancestors and document remain open. `doc-done` finalizes all regions and closes the document. Call `reset()` before starting another document.
- **Replay:** previously accepted sequence numbers are ignored. Rejected events do not consume a sequence number. The producer must supply ordered events; this is not an out-of-order network-delivery repair mechanism.
- **Bounded:** documents are limited to 1000 regions, region depth 32, 1 MB per region, and 4 MB per document by default; custom elements nest at most 64 deep.
- **Interruption:** the React adapter distinguishes a completed document from a transport ending before `doc-done`. Fatal errors stop consumption. Caller-owned EventSource connections are not closed by the adapter.

The renderer's streaming test suite streams a corpus of 9 documents character by character (about 1,400 prefixes) and asserts: no syntax flashes (the visible text of every prefix is a prefix of the final visible text), no retraction (visible text only grows), and no premature links (every link or image shown mid-stream already has its final destination). The same corpus without repair produced 436 flashing prefixes, 46 retractions, and 97 premature links. Intraword delimiters (`2*3`, `snake_case`) stay literal. Finalization (`region-done`, `doc-done`, and every static render) uses ordinary CommonMark + GFM semantics; the provisional view never affects the final document. Incomplete custom syntax is preserved on finalization with diagnostics.

HTMD is **not a fully incremental Markdown parser**. It reparses the affected region, reuses unchanged AST-block render results, and reconciles changed DOM instead of reconstructing every component. Keep independent interactive content in separate regions when appropriate.

Producers can check a document before sending it with `validateNodes`, which applies the same contract rules as the renderer.

## React

```tsx
import { baseCatalog, createHost } from '@htmdjs/contracts';
import { HtmdDoc, useHtmdStream } from '@htmdjs/react';
import type { HtmdStreamSource } from '@htmdjs/react';

const host = createHost({ components: baseCatalog });

export function StaticMessage() {
  return <HtmdDoc source={'# Hello\n\n**Markdown**, with optional components.'} host={host} />;
}

export function StreamedMessage({ source }: { source: HtmdStreamSource }) {
  const { ref, status, error } = useHtmdStream(source, { host });
  return <section><div ref={ref} /><p>{status}{error ? `: ${error}` : ''}</p></section>;
}
```

Keep `source` and `host` stable across renders. Supported sources: synchronous/async iterables of events, `ReadableStream<WireEvent>`, and `EventSource`. `done` means an accepted `doc-done`, not simply EOF. An empty finite source stays `idle`; a nonempty truncated source becomes `error`.

## Packages

| Package | Purpose |
|---|---|
| [`@htmdjs/core`](./packages/htmd) | Meta package: contracts, parser, wire protocol, components, and renderer. |
| [`@htmdjs/contracts`](./packages/contracts) | Component contracts, catalogs, host capabilities, intents, payload schemas, and validation. |
| [`@htmdjs/parser`](./packages/parser) | Dependency-free source parser, streaming/pending state, diagnostics, and decoded attributes. |
| [`@htmdjs/wire`](./packages/wire) | Zod-validated event shapes and JSON event parsing. |
| [`@htmdjs/elements`](./packages/elements) | Nine Lit components for choices, refinement, files, images, tables, code, messages, and structured fragments. |
| [`@htmdjs/renderer`](./packages/renderer) | Contract-enforcing static rendering and state-preserving region streaming. |
| [`@htmdjs/react`](./packages/react) | Static document component and stream lifecycle hook. |

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

This alpha does not persist server event logs, reconnect a transport automatically, serialize user interaction state for replay, or make external data URLs immutable. Replay reproduces document instructions, not a historical snapshot of changing remote resources.

Bench's entity-decoding fix and its parser/renderer regression coverage are included. Bench-specific editor schemas, HTML-import normalization, and application authorization remain in Bench.

- [Full specification](./spec/htmd-spec.md)
- [Model-facing instructions](./AI_SPEC.md)
- [Release notes](./.changeset/contracts-and-host-capabilities.md)

## Licence

MIT.
