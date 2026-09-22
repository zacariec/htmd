# `@htmdjs/renderer`

Framework-independent DOM rendering for HTMD.

- `renderHtmdSource(target, source)` renders a static document and returns parser diagnostics.
- `materializeInto(target, nodes, options?)` reconciles parsed nodes without needlessly replacing component instances.
- `RegionTreeRenderer` consumes decoded `@htmdjs/wire` events into addressable regions.

```ts
import { RegionTreeRenderer } from '@htmdjs/renderer';
import { registerHtmdElements } from '@htmdjs/elements';

registerHtmdElements();
const container = document.querySelector('#stage');
if (!container) throw new Error('Missing stage');
const renderer = new RegionTreeRenderer(container);
for await (const event of wireStream) {
  if (!renderer.apply(event)) break;
}
```

Listen to `RendererEvents.Error` for rejection details and `RegionUpdated` for parse diagnostics. Incomplete streaming syntax sets `data-htmd-pending` on the region. Finalization flushes pending source through final parsing.

`region-done` seals the actual subtree. `region-replace` explicitly resets its body and descendants, reopening the region only while its ancestors and document remain open. `doc-done` finalizes remaining regions and closes mutation; `reset()` starts a fresh context. Supported `schemaVersion` is `0.1`. Invalid events do not advance `lastAppliedSeq`; previously accepted sequence numbers are replay no-ops.

Unchanged custom elements retain their shadow DOM, focused input, selection, loaded data, and runtime-reflected attributes. Source attribute changes remain authoritative. Reconciliation is positional, not keyed movement. Explicit replacement intentionally discards local interaction state.

Each append still parses the affected region. Unchanged blocks reuse rendered results; changed Markdown spans are rendered with micromark and reconciled. This is not a fully incremental Markdown parser.

Raw HTML stays escaped and `on*` attributes are refused. Register only trusted components; components own their URL and payload policies.

Part of [HTMD](https://github.com/zacariec/htmd). Install with `npm install @htmdjs/renderer@alpha`.
