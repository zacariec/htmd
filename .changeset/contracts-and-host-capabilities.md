---
'@htmdjs/core': minor
'@htmdjs/contracts': minor
'@htmdjs/parser': minor
'@htmdjs/elements': minor
'@htmdjs/wire': minor
'@htmdjs/renderer': minor
'@htmdjs/react': minor
---

Component contracts and host capabilities. HTMD is now a streaming-first document protocol and runtime for Markdown and interactive components, where every component has an executable contract and the host decides what a document may use.

**Breaking changes**

- `<data-table>` is blocked by default. Data URLs load only when the host's `authorizeUrl` allows purpose `data`; `defaultHost` never does. Provide a host with `createHost({ components, authorizeUrl, loadData })`.
- `DataTable.urlPolicy` is removed. Every component URL passes `authorizeComponentUrl` and the host's per-purpose policy (`data`, `image`, `link`, `download`); the default allows same-origin images, links, and downloads.
- `@htmdjs/elements` no longer exports `HtmdElementEvents`, `ChoiceDetail`, `ChoiceSelectDetail`, or `RefineDetail`. Import `ComponentEvents`, `ChoiceDetail`, and `RefineDetail` from `@htmdjs/contracts` (or `@htmdjs/core`). `choice` and `refine` details now include `region`, the originating `data-htmd-region`.
- The renderer renders only components in the host catalog and only their declared, valid attributes. Unknown components, unsupported `data-htmd-version` pins, missing or invalid attributes, and rule errors render a `data-htmd-fallback` text projection instead of the component. Unknown attributes are dropped.
- `renderHtmdSource(target, source, { host? })` returns `RenderResult { document, pending, diagnostics }` with parser and contract diagnostics. `materializeInto(target, nodes, { streaming?, host? })` returns contract diagnostics. `new RegionTreeRenderer(root, { host?, limits? })`. `RegionUpdatedDetail.diagnostics` is `ReadonlyArray<HtmdDiagnostic>`.
- React: `HtmdDoc` accepts `host`; `useHtmdStream(source, { host?, limits? })`; `onDiagnostics` receives `ReadonlyArray<HtmdDiagnostic>`. Keep `host` identity stable.
- `<refine-prompt target>` must be a region ID such as `$.answer`; other values render a fallback.
- `complete`-policy components (`choice-item`, `data-table`, `file-preview`, `image-card`, `refine-prompt`, `htmd-fragment`) are not instantiated until their closing tag arrives; meanwhile each renders one `<div data-htmd-deferred="{tag}" aria-busy="true">` placeholder at its position, and it falls back if still unclosed at finalization.
- `data-htmd-pending` on a region now means known incomplete custom syntax **or** a provisional Markdown frontier.
- `initial`-owned attributes (`<choice-group value>`) are set only when the element is created and are no longer reconciled from source.
- Documents exceeding render limits are closed with a non-recoverable error (defaults: 1000 regions, region depth 32, 1,000,000 bytes per region, 4,000,000 bytes per document). Custom elements nested deeper than 64 levels stay literal with a `nesting-too-deep` error.

**Additions**

- New `@htmdjs/contracts` package: `ComponentContract`, immutable `ComponentCatalog`, the nine base contracts and `baseCatalog`, `resolveComponent`, `resolveChildren`, `validateNodes` for producers, `ContractDiagnostic`/`HtmdDiagnostic`, host APIs (`createHost`, `defaultHost`, `provideHtmdHost`, `revokeHtmdHost`, `requestHtmdHost`, `authorizeComponentUrl`, `sameOriginMediaPolicy`), intents, payload schemas (`TablePayload`, `TableBatch`, `MAX_TABLE_ROWS`, `FragmentNode`, `FragmentState`), and the shared `sanitizeUrl` scheme gate.
- Host data loaders: `loadData` returns a complete payload or an async iterable of batches; `<data-table>` renders validated `TableBatch` rows progressively and reports interruption without discarding received rows.
- Parser: `ElementBlock.complete`, `ParseOptions.rawTextTags` (default `DEFAULT_RAW_TEXT_TAGS`), and `ParseOptions.maxDepth` (default 64).
- Renderer: `MaterializeOptions`, `RenderResult`, `RenderLimits`, and `DEFAULT_RENDER_LIMITS`.
- Streaming Markdown partial rendering. While a region streams, its Markdown frontier renders provisionally: unambiguous syntax is completed (open emphasis, strong, strikethrough, and inline code close at the end; `**Hello*` shows bold `Hello`), ambiguous syntax is withheld (marker-only last lines, table headers before their delimiter row, partial closing fences, an unresolved `[`, a `[label]` awaiting its destination, a trailing `!`), and partial links are never interactive (a label whose destination is still streaming shows as text; partial images and angle autolinks are withheld; trailing bare URLs and emails link once whitespace ends them). Intraword delimiters stay literal. Finalization and static renders use ordinary CommonMark + GFM. On a 9-document corpus streamed character by character (~1,400 prefixes) the renderer now shows 0 syntax flashes, 0 retractions, and 0 premature links (previously 436, 46, and 97). Regions are still reparsed per chunk; this is not a fully incremental Markdown parser.
- `data-htmd-deferred` placeholders give deferred components a styleable skeleton hook.
- `@htmdjs/core` re-exports the full `@htmdjs/contracts` API.
- Specification, model instructions, and package documentation describe contracts, host control, partial policies, streaming Markdown, state ownership, intents, limits, and diagnostics. The playground provides a host whose loader streams the sample table in batches.
