# `@htmdjs/renderer`

Framework-independent DOM rendering for HTMD. Enforces component contracts from the host's catalog while content streams.

- `renderHtmdSource(target, source, { host? })` renders a static document, provides `host` to the components inside `target`, and returns a `RenderResult { document, pending, diagnostics }` with parser and contract diagnostics.
- `materializeInto(target, nodes, { streaming?, host? })` reconciles parsed nodes without needlessly replacing component instances and returns the contract diagnostics.
- `renderHtmdToString(source, { host? })` renders a static document to an HTML string without a DOM and returns `HtmdStringRender { html, diagnostics }`. See [Server rendering](#server-rendering).
- `RegionTreeRenderer` consumes decoded `@htmdjs/wire` events into addressable regions.

```ts
import { baseCatalog, createHost } from '@htmdjs/contracts';
import { registerHtmdElements } from '@htmdjs/elements';
import { RegionTreeRenderer } from '@htmdjs/renderer';

registerHtmdElements();
const host = createHost({ components: baseCatalog.without('data-table') });
const container = document.querySelector('#stage');
if (!container) throw new Error('Missing stage');
const renderer = new RegionTreeRenderer(container, { host, limits: { maxRegions: 200 } });
for await (const event of wireStream) {
  if (!renderer.apply(event)) break;
}
```

Without a `host` option, `defaultHost` from `@htmdjs/contracts` applies: the base catalog, same-origin images/links/downloads, and no data loading.

## Contract enforcement

Each custom element is resolved against `host.components`:

- **Render:** the component is created with validated, declared attributes only; unknown attributes are dropped with a warning. `source`-owned attributes reconcile on later source changes. `initial`-owned attributes are set only at creation and are never re-applied or removed. Children follow the contract: `text` content is set as raw text, `none` gets no children, and other kinds render recursively under the same host.
- **Defer:** a `complete`-policy component whose closing tag has not arrived is not instantiated. Its position holds one placeholder, `<div data-htmd-deferred="{tag}" aria-busy="true">` (style it as a skeleton), which the component replaces when its closing tag arrives.
- **Fallback:** unavailable components, unsupported `data-htmd-version` pins, invalid or missing attributes, and rule errors render `<div data-htmd-fallback="{tag}">`. It never instantiates components: a `text`-kind contract shows its raw text in a `<pre>`; otherwise the Markdown inside the element (component wrappers flattened) is rendered as Markdown.

A change of resolution kind or tag replaces that block's DOM. The parser receives `host.components.rawTextTags()`, so raw-text payloads (such as `<code-block>` and `<htmd-fragment>`) are never parsed as HTMD.

## Server rendering

`renderHtmdToString` runs in plain Node, workers, and edge runtimes: it never touches `document`, `window`, or `customElements`. Its `html` is exactly what `renderHtmdSource` would materialize into an empty container — parsed by a browser, it produces the same DOM — and its `diagnostics` equal that render's. The output is:

- Markdown rendered as safe HTML (raw HTML escaped, dangerous link protocols stripped).
- Allowed components as their custom-element tags with only validated, declared attributes, and children per contract. These are inert markup until the elements register on the client (`registerHtmdElements()`), then they upgrade in place.
- Fallbacks as `<div data-htmd-fallback="{tag}">` holding their text projection, exactly as in the DOM render.

Component shadow content, host-provided data loads, and interaction happen on the client after upgrade; the server string carries none of them. To hydrate, give the page the same `source` and `host` and call `renderHtmdSource` on the container: it re-materializes the same content in place.

```ts
import { renderHtmdToString } from '@htmdjs/renderer';

const { html, diagnostics } = renderHtmdToString(source, { host });
response.end(`<article id="doc">${html}</article>`);
```

## Streaming lifecycle

Listen to `RendererEvents.Error` for rejection details and `RegionUpdated` for diagnostics (`RegionUpdatedDetail.diagnostics: ReadonlyArray<HtmdDiagnostic>`). A region carries `data-htmd-pending` while it has known incomplete custom syntax or a provisional Markdown frontier. Finalization flushes pending source through final parsing; a `complete`-policy component still missing its closing tag then renders a fallback with an `incomplete-component` diagnostic.

`region-done` seals the actual subtree. `region-replace` explicitly resets its body and descendants, reopening the region only while its ancestors and document remain open. `doc-done` finalizes remaining regions and closes mutation; `reset()` starts a fresh context. Supported `schemaVersion` is `0.1`. Invalid events do not advance `lastAppliedSeq`; previously accepted sequence numbers are replay no-ops.

## Streaming Markdown

While a region streams, its frontier — the last Markdown node, including the last child of a component still streaming — renders as provisional Markdown so readers never see syntax that later vanishes:

- **Completed when unambiguous:** open emphasis, strong, strikethrough, and inline code close at the end of the text; partial closers are completed (`**Hello*` shows bold `Hello`).
- **Withheld when ambiguous:** a last line of only block markers (`-`, `1.`, `>`, `#`, `|`, backticks, a task `[x`), a table header before its delimiter row, a partial closing fence inside an open code block, an unresolved `[` or a `[label]` awaiting its destination, and a trailing `!`.
- **Never interactive while partial:** a link whose destination is still streaming shows its label as plain text; partial images and `<…>` angle autolinks are withheld; a trailing bare URL or email shows as escaped, unlinked text and links once whitespace ends it.

Intraword delimiters (`2*3`, `snake_case`) stay literal. Finalization and static rendering (`renderHtmdSource`) use ordinary CommonMark + GFM; the provisional view never affects the final document.

`test/markdown-streaming.test.ts` streams a 9-document corpus character by character (about 1,400 prefixes) and asserts no syntax flashes, no retraction of visible text, and no premature links; the same corpus without repair produces 436, 46, and 97 violations respectively. `test/streaming-markdown.test.ts` pins that unambiguous content still appears immediately.

## Limits

`RenderLimits` bounds one document; pass a `Partial<RenderLimits>` as `limits`. Defaults (`DEFAULT_RENDER_LIMITS`):

| Limit | Default |
|---|---|
| `maxRegions` | 1000 |
| `maxRegionDepth` | 32 |
| `maxRegionBytes` | 1,000,000 |
| `maxDocumentBytes` | 4,000,000 |

An event that would exceed a limit is rejected (`apply` returns `false`), a non-recoverable `RendererEvents.Error` is emitted, and the document closes. The parser separately leaves custom-element tags nested deeper than 64 levels as literal Markdown with a `nesting-too-deep` error.

## Reconciliation

Unchanged custom elements retain their shadow DOM, focused input, selection, loaded data, and runtime-reflected attributes. Reconciliation is positional, not keyed movement. Explicit replacement intentionally discards local interaction state.

Each append reparses the affected region; this is not a fully incremental Markdown parser. Unchanged blocks reuse rendered results; changed Markdown spans and the provisional frontier are rendered with micromark and reconciled.

Raw HTML stays escaped and `on*` attributes are refused. Components decide their URLs and data through the host; registering a custom element does not make it available to documents.

Part of [HTMD](https://github.com/zacariec/htmd). Install with `npm install @htmdjs/renderer@alpha`.
