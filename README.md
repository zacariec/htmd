# HTMD

A streaming-first Markdown implementation and document-update protocol for AI output.

Markdown already supports streamed text and embedded HTML. HTMD adds an explicit contract for addressable regions, partial custom-element syntax, interactive components, completion, and targeted revisions. It is not a replacement for CommonMark or GFM.

## Install the alpha

```sh
npm install @zacariec/htmd@alpha
# Optional React adapter:
npm install @zacariec/htmd-react@alpha
```

The packages belong to the `@zacariec` scope. The unrelated unscoped npm package `htmd` is not this project.

Importing the meta package with the browser export condition registers the base custom elements. Node/SSR imports do not register elements; DOM rendering still requires a browser.

## Stream into a document

```ts
import { RegionTreeRenderer, registerHtmdElements } from '@zacariec/htmd';

registerHtmdElements();
const container = document.querySelector('#answer');
if (!container) throw new Error('Missing answer container');
const renderer = new RegionTreeRenderer(container);

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

## What streaming guarantees

- **Partial syntax:** incomplete custom-element tags are buffered rather than flashed as literal markup. Open elements can render available children. `data-htmd-pending` marks known incomplete syntax.
- **Stable interaction:** appending prose preserves unchanged component instances, selections, loaded data, and focused refinement drafts. Explicit `region-replace` deliberately replaces the region body and its descendants.
- **Targeted updates:** regions can fill independently. Replacement follows actual parentage, including explicit parents whose IDs have a different prefix.
- **Completion:** `region-done` finalizes and seals a region and its subtree. `region-replace` can reopen it while its ancestors and document remain open. `doc-done` finalizes all regions and closes the document. Call `reset()` before starting another document.
- **Replay:** previously accepted sequence numbers are ignored. Rejected events do not consume a sequence number. The producer must supply ordered events; this is not an out-of-order network-delivery repair mechanism.
- **Interruption:** the React adapter distinguishes a completed document from a transport ending before `doc-done`. Fatal errors stop consumption. Caller-owned EventSource connections are not closed by the adapter.

Ordinary Markdown remains provisional: unfinished emphasis may show its delimiters until completed, and later reference definitions can change earlier output. Finalization uses normal Markdown semantics; it does not invent delimiters or link destinations. Incomplete custom syntax is preserved on finalization with diagnostics.

HTMD is **not a fully incremental Markdown parser**. It reparses the affected region, reuses unchanged AST-block render results, and reconciles changed DOM instead of reconstructing every component. Keep independent interactive content in separate regions when appropriate.

## React

```tsx
import { HtmdDoc, useHtmdStream } from '@zacariec/htmd-react';
import type { HtmdStreamSource } from '@zacariec/htmd-react';

export function StaticMessage() {
  return <HtmdDoc source={'# Hello\n\n**Markdown**, with optional custom elements.'} />;
}

export function StreamedMessage({ source }: { source: HtmdStreamSource }) {
  const { ref, status, error } = useHtmdStream(source);
  return <section><div ref={ref} /><p>{status}{error ? `: ${error}` : ''}</p></section>;
}
```

Keep `source` stable across renders. Supported sources: synchronous/async iterables of events, `ReadableStream<WireEvent>`, and `EventSource`. `done` means an accepted `doc-done`, not simply EOF. An empty finite source stays `idle`; a nonempty truncated source becomes `error`.

## Packages

| Package | Purpose |
|---|---|
| [`@zacariec/htmd`](./packages/htmd) | Meta package: parser, wire protocol, components, and renderer. |
| [`@zacariec/htmd-parser`](./packages/parser) | Dependency-free source parser, streaming/pending state, diagnostics, and decoded attributes. |
| [`@zacariec/htmd-wire`](./packages/wire) | Zod-validated event shapes and JSON event parsing. |
| [`@zacariec/htmd-elements`](./packages/elements) | Nine Lit components for choices, refinement, files, images, tables, code, messages, and structured fragments. |
| [`@zacariec/htmd-renderer`](./packages/renderer) | Static rendering and state-preserving region streaming. |
| [`@zacariec/htmd-react`](./packages/react) | Static document component and stream lifecycle hook. |

## Playground and development

Node 22 or newer and the pinned pnpm version are required.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @htmd-examples/playground dev
```

Open `http://localhost:5173/`, choose **Streaming**, and use the partial-syntax/interaction example. Select **Wire chunks** and **Manual**, step to the choice and refinement controls, interact, then keep stepping. Character-by-character playback is also available. The static sample's `/api`, image, and download URLs illustrate host-provided resources; supply those endpoints when using that sample.

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter './examples/*' run build
```

## Security and alpha scope

Raw HTML is escaped; inline event-handler attributes are refused. Built-in components apply their own URL and payload policies. Register only trusted custom elements: their implementations decide what attributes do, and a hyphenated tag name is not a sandbox. Same-origin fetches still require the host application's authorization and endpoint policy.

This alpha does not persist server event logs, reconnect a transport automatically, serialize user interaction state for replay, or make external data URLs immutable. Replay reproduces document instructions, not a historical snapshot of changing remote resources.

Bench's entity-decoding fix and its parser/renderer regression coverage are included. Bench-specific editor schemas, HTML-import normalization, and application authorization remain in Bench.

- [Full specification](./spec/htmd-spec.md)
- [Model-facing instructions](./AI_SPEC.md)
- [Alpha release notes](./.changeset/initial-alpha.md)

## Licence

MIT.
