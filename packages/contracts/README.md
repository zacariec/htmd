# `@htmdjs/contracts`

Executable component contracts, host capabilities, and validation for HTMD. DOM-free: producers validate against contracts, renderers enforce them, and documentation and model instructions derive from them.

```ts
import { baseCatalog, createHost } from '@htmdjs/contracts';
import type { TableBatch } from '@htmdjs/contracts';

// Only these components render in this host; the rest render as text.
const host = createHost({
  components: baseCatalog.without('file-preview'),
  authorizeUrl: ({ url, purpose, element }) =>
    url.origin === new URL(element.ownerDocument.baseURI).origin &&
    (purpose !== 'data' || url.pathname.startsWith('/api/reports/')),
  async *loadData({ url, signal }): AsyncIterable<TableBatch> {
    const response = await fetch(url, { signal, credentials: 'same-origin' });
    yield (await response.json()) as TableBatch;
  },
});
```

Pass `host` to `renderHtmdSource`, `RegionTreeRenderer`, `<HtmdDoc host>`, or `useHtmdStream(source, { host })`. Without one, `defaultHost` applies.

## Component contracts

A `ComponentContract` describes one component:

| Field | Meaning |
|---|---|
| `tag` | Custom-element tag name (must contain a hyphen). |
| `version` | Positive integer. Source may pin it with `data-htmd-version` (`VERSION_ATTRIBUTE`); any other value renders a fallback. |
| `description` | What the component is for. |
| `attributes` | Per attribute: `description`, a zod `schema` for the complete string value, `required?`, `ownership` (`'source'` or `'initial'`), and `url?` purpose (`'data'`, `'image'`, `'link'`, `'download'`). |
| `children` | `none` (non-whitespace children dropped), `text` (raw payload, never parsed as HTMD or Markdown), `markdown` (Markdown only; nested components dropped), `flow` (Markdown plus any component the host catalog allows), or `components` with an `allowed` tag list. |
| `partial` | `'progressive'` renders while the closing tag is still streaming; `'complete'` is not instantiated until the closing (or self-closing) tag arrives. |
| `partialBehavior` | What readers see while the component, its children, or its data are incomplete. |
| `state` | Which runtime state the user or component owns, and what resets it. |
| `events` | Public intents: `name`, `description`, and a zod `detail` schema. |
| `effects` | Declared side effects: `load-data`, `load-image`, `navigate`, `download`, `clipboard`, `emit-intent`. |
| `accessibility` | Roles, labelling, and keyboard behavior. |
| `examples` | Complete, valid sources (at least one). |
| `validate?` | Rules spanning attributes or children. Error issues render a fallback. |

Attribute ownership: `source` attributes follow later source changes; `initial` attributes are applied when the element is created, after which the user or component owns the value and source changes are ignored.

Contracts may not declare `data-htmd-version` or any attribute beginning with `on`.

## Catalogs

`ComponentCatalog` is the immutable set of components a host makes available. `ComponentCatalog.of(contracts)` rejects duplicate tags; `with(...contracts)` adds or replaces, `without(...tags)` removes; `get`, `has`, `tags`, and `contracts` inspect it. `rawTextTags()` returns the tags with `text` children, for the parser's `rawTextTags` option.

Registration in the global custom-element registry is not permission: a renderer instantiates only components in its host's catalog.

`baseCatalog` holds the nine base contracts (`baseContracts`; also exported individually as `chatMessageContract`, `choiceGroupContract`, `choiceItemContract`, `codeBlockContract`, `dataTableContract`, `filePreviewContract`, `imageCardContract`, `refinePromptContract`, `htmdFragmentContract`).

## Resolution and validation

`resolveComponent(node, catalog, { streaming })` decides how a parsed element renders. Precedence: availability → version pin → completeness → attributes → component rules.

- `render`: instantiate with `attrs` — validated, declared attributes only. Unknown attributes are dropped with a warning.
- `defer`: a `complete`-policy component is still streaming; do not instantiate it yet (the renderer shows a `data-htmd-deferred` placeholder).
- `fallback`: do not instantiate; render a neutral text projection. Produced by an unknown component, an unsupported version pin, a `complete`-policy component that ended without its closing tag in final parsing, a missing or invalid attribute, or an error from `validate`.

`resolveChildren(node, contract)` returns the children a rendered component receives, dropping disallowed content with warnings.

`validateNodes(nodes, catalog, options?)` validates parsed nodes exactly as the renderer resolves them. Producers can run it before sending a document:

```ts
import { Parser } from '@htmdjs/parser';
import { baseCatalog, validateNodes } from '@htmdjs/contracts';

const parsed = Parser.getInstance().parse(source, { rawTextTags: baseCatalog.rawTextTags() });
const problems = [...parsed.diagnostics, ...validateNodes(parsed.document.nodes, baseCatalog)];
```

`ContractDiagnostic` carries `severity`, `code` (`ContractDiagnosticCode`: `unknown-component`, `unsupported-component-version`, `missing-attribute`, `invalid-attribute`, `unknown-attribute`, `disallowed-child`, `incomplete-component`, `component-rule`), `message`, `tag`, `start`, and `end`. `HtmdDiagnostic` is the union of parser and contract diagnostics.

## Hosts

`HtmdHost` is `{ components, authorizeUrl, loadData }`; build one with `createHost({ components, authorizeUrl?, loadData? })`.

- `authorizeUrl({ url, purpose, component, element })` decides each URL per purpose. The default, `sameOriginMediaPolicy`, allows same-origin `image`, `link`, and `download` URLs and **never** authorizes `data`: a model-provided URL is not permission to fetch it.
- `loadData({ url, component, element, signal })` returns a complete payload (`Promise`) or an `AsyncIterable` of batches for components that support progressive data. `signal` aborts when the component is removed or its source changes. Without a loader, components fetch authorized `data` URLs as JSON.
- `defaultHost` is `baseCatalog`, the default policy, and no loader.

Components find their host at effect time. `provideHtmdHost(target, host)` answers `htmd-host-request` events (`HOST_REQUEST_EVENT`, bubbling and composed) from descendants of `target`; the nearest provider wins and providing again replaces the host. `revokeHtmdHost(target)` removes it. `requestHtmdHost(element, fallback = defaultHost)` returns the governing host; call it when an effect is about to happen, since disconnected elements cannot reach their provider.

`authorizeComponentUrl(element, raw, purpose, host)` is the single URL gate: `sanitizeUrl` scheme allowlist, resolution against the document base, `http:`/`https:` only for `data`, `image`, and `download`, then `host.authorizeUrl`. It returns the `URL` to use, or `undefined`.

## Intents and payloads

`ComponentEvents.Choice` (`'choice'`, detail `ChoiceDetail { name, value, region? }`) and `ComponentEvents.Refine` (`'refine'`, detail `RefineDetail { target, prompt, region? }`) bubble and are composed. `region` is the nearest enclosing `data-htmd-region`, found with `originRegion(element)` across shadow roots. The zod schemas share the type names.

Payload schemas validate untrusted data before any of it renders: `TablePayload { columns, rows }`, `TableBatch { columns?, rows }` (the first batch must carry `columns`; later batches append rows), `MAX_TABLE_ROWS` (5000), `FragmentNode { tag, class?, text?, for?, attrs?, children? }`, and `FragmentState` (a JSON object).

Part of [HTMD](https://github.com/zacariec/htmd). Install with `npm install @htmdjs/contracts@alpha`.
