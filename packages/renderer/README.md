# `@htmdjs/renderer`

Framework-independent DOM rendering for HTMD. Enforces component contracts from the host's catalog while content streams.

- `renderHtmdSource(target, source, { host? })` renders a static document, provides `host` to the components inside `target`, and returns a `RenderResult { document, pending, diagnostics }` with parser and contract diagnostics.
- `materializeInto(target, nodes, { streaming?, host? })` reconciles parsed nodes without needlessly replacing component instances and returns the contract diagnostics.
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
- **Defer:** a `complete`-policy component whose closing tag has not arrived renders nothing yet and keeps its position.
- **Fallback:** unavailable components, unsupported `data-htmd-version` pins, invalid or missing attributes, and rule errors render `<div data-htmd-fallback="{tag}">`. It never instantiates components: a `text`-kind contract shows its raw text in a `<pre>`; otherwise the Markdown inside the element (component wrappers flattened) is rendered as Markdown.

A change of resolution kind or tag replaces that block's DOM. The parser receives `host.components.rawTextTags()`, so raw-text payloads (such as `<code-block>` and `<htmd-fragment>`) are never parsed as HTMD.

## Streaming lifecycle

Listen to `RendererEvents.Error` for rejection details and `RegionUpdated` for diagnostics (`RegionUpdatedDetail.diagnostics: ReadonlyArray<HtmdDiagnostic>`). Incomplete streaming syntax sets `data-htmd-pending` on the region. Finalization flushes pending source through final parsing; a `complete`-policy component still missing its closing tag then renders a fallback with an `incomplete-component` diagnostic.

`region-done` seals the actual subtree. `region-replace` explicitly resets its body and descendants, reopening the region only while its ancestors and document remain open. `doc-done` finalizes remaining regions and closes mutation; `reset()` starts a fresh context. Supported `schemaVersion` is `0.1`. Invalid events do not advance `lastAppliedSeq`; previously accepted sequence numbers are replay no-ops.

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

Each append still parses the affected region. Unchanged blocks reuse rendered results; changed Markdown spans are rendered with micromark and reconciled. This is not a fully incremental Markdown parser.

Raw HTML stays escaped and `on*` attributes are refused. Components decide their URLs and data through the host; registering a custom element does not make it available to documents.

Part of [HTMD](https://github.com/zacariec/htmd). Install with `npm install @htmdjs/renderer@alpha`.
