# `.htmd` Specification

**Status:** 0.1 alpha.
**Version:** `0.1.0-alpha.3`

## 1. What `.htmd` is

`.htmd` is a streaming-first document protocol and runtime for Markdown and interactive components. It defines how incomplete content renders, how addressed sections change, and how interaction survives updates.

1. **Markdown for prose, components for structure and interaction.** Markdown handles prose, headings, lists, code, basic tables, links, and emphasis. When a document needs something Markdown cannot express (choices, revisions, files, data, structured cards), it uses a *component*: a custom element from a library the host controls. Plain HTML elements (`<p>`, `<strong>`, `<ul>`) are forbidden.

2. **Components have executable contracts.** Each component declares its attributes, children, partial-rendering policy, state ownership, intents, and effects (§4). Producers validate against contracts, renderers enforce them, and the host decides which components, URLs, and data a document may use.

3. **Documents are live, addressed trees.** Each renderable region is addressable. Regions fill independently, complete, and are replaced mid-stream; replay after reconnect reproduces document instructions (§3). External data and user interaction state require separate snapshotting if historical reproduction is needed.

## 2. The format on disk

A `.htmd` document is a UTF-8 string. It looks like Markdown with components:

```htmd
Looking at the data now.

<data-table src="/api/sales/q4"/>

## Recommendation

Three options, pick one:

<choice-group name="next-step">
  <choice-item value="dig-deeper">Dig into the top performer</choice-item>
  <choice-item value="export">Export the table</choice-item>
  <choice-item value="another-cut">Show me a different cut</choice-item>
</choice-group>
```

### Markdown surface

CommonMark + GFM (tables, strikethrough, task lists, autolinks, fenced code). Inline HTML is restricted to **custom elements only** — any tag containing a hyphen. Only custom elements available in the host catalog render as components (§4.2).

### Custom element surface

- Tag name must contain at least one hyphen (per the Custom Elements spec).
- Attributes follow standard HTML attribute syntax (kebab-case attribute names).
- Attribute values use double quotes. Single quotes are accepted with a warning diagnostic.
- Children are Markdown, more components, or a raw text payload, as the component's contract declares (§4.1).
- **Raw-text components.** Content of components whose contract declares `text` children (in the base set, `<code-block>` and `<htmd-fragment>`) is a literal payload: it is never parsed as `.htmd` or Markdown, and only the matching closing tag ends it. The parser takes these tags as `rawTextTags` (default `htmd-fragment`, `code-block`); renderers pass the host catalog's `rawTextTags()`.
- **Nesting limit.** Custom-element opening tags nested deeper than 64 levels (`maxDepth`) stay literal Markdown with a `nesting-too-deep` error diagnostic.

### Forbidden

- Plain HTML elements (`<p>`, `<strong>`, `<ul>`, `<h1>`, `<a>`, etc.). Use Markdown.
- `<script>`, `<style>`, `<iframe>`, `<object>`, `<embed>`, `<link>`, `<meta>`, `<base>`, `<form>`. Reported as error diagnostics.
- Inline event handlers (`onclick="…"` and any `on*=` attribute). Reported as error diagnostics. Contracts cannot declare `on*` attributes.
- `javascript:` URLs (in attribute values or Markdown link targets). Reported as error diagnostics.
- Template strings or expression syntax in attribute values. Attributes are literal data, not code.

### Partial-source rendering

`Parser.parse(source, { streaming: true })` retains the complete input in `document.source`, withholds plausible incomplete tag suffixes from renderable nodes, and returns `pending: true` for known unfinished tag/code syntax or open custom elements. Open elements render available children without premature missing-close diagnostics. Complete prose is not marked pending merely because the transport remains open. Each `ElementBlock` records `complete`: `true` for self-closing elements and elements whose closing tag was found, `false` while the closing tag has not arrived.

Final parsing (`Parser.parse(source)`) clears `pending`, preserves unfinished custom syntax as literal Markdown with diagnostics, and reports missing closing tags. Unexpected closing tags remain literal rather than disappearing. Fences and inline code do not instantiate custom elements.

Whether an open component renders while streaming is decided by its contract's partial policy (§4.4).

### Partial Markdown

Only the *frontier* of a streaming region can be incomplete: the last Markdown node in the region, including the last child of a component that is itself still streaming. Blocks before a blank line, a closed fence, or a later component are finished. While streaming, the renderer renders the frontier as provisional Markdown under three rules:

1. **Complete what is unambiguous.** Open emphasis, strong, strikethrough, and inline code are closed at the end of the text, and partial closers are completed: `Revenue grew **12` shows bold `12`, and `**Hello*` shows bold `Hello`.
2. **Withhold what is ambiguous.** A last line containing only block markers (`-`, `1.`, `>`, `#`, `|`, backticks, a task `[x`); a table header until a matching delimiter row arrives; a partial closing fence inside an open code block; an unresolved `[` (a link, citation, or literal text) until it resolves; a closed `[label]` still awaiting its destination; a trailing `!`.
3. **Never make partial things interactive.** A link whose destination is still streaming shows its label as plain text. Partial images and partial `<…>` angle autolinks are withheld. A trailing bare URL or email streams as visible, escaped, unlinked text and becomes a link once whitespace ends it.

Intraword delimiters (`2*3`, `snake_case`) stay literal. No destinations are invented.

The reference renderer's test suite streams a corpus of 9 documents character by character (about 1,400 prefixes) and asserts three properties for every prefix: **no syntax flashes** (the visible text of each prefix is a prefix of the final visible text), **no retraction** (visible text only grows), and **no premature links** (every link or image shown mid-stream has its final destination). Without the repair, the same corpus shows 436 flashing prefixes, 46 retractions, and 97 premature links.

Finalization (`region-done`, `doc-done`) and every static render use ordinary CommonMark + GFM semantics. The provisional view never affects the final document.

The renderer sets `data-htmd-pending` on a region while it has known incomplete custom syntax or a provisional Markdown frontier.

### Attribute values

Attribute values decode `amp`, `lt`, `gt`, `quot`, `apos`, and valid numeric Unicode references exactly once. Unknown and invalid references stay literal. This incorporates Bench's attribute round-trip fix.

## 3. The wire protocol

`.htmd` documents stream over a connection (SSE, WebSocket, or any transport that preserves event order) as **region-addressed events**. Every field name on the wire is camelCase.

### Region IDs

Each addressable region has a hierarchical path identifier, `$`-rooted, dot-separated segments of `[A-Za-z0-9_-]+`:

```
$                                          document root
$.channel.msg.abc123                       top-level message region
$.channel.msg.abc123.body                  the body of that message
$.channel.msg.abc123.body.tool-call-1      nested region inside the body
```

Rendered regions carry their ID in `data-htmd-region`. Components use it to attribute intents (§4.6), and `<refine-prompt target>` names the region to revise.

### Event vocabulary

| Event | Payload | Effect |
|---|---|---|
| `doc-open` | `{ seq, id, schemaVersion }` | Open a document context. Consumer sets up its root region. |
| `region` | `{ seq, id, tag, parent?, attrs? }` | Declare a region. Allocates an element of `tag`, attaches to `parent` (default: the region at the id's path prefix, else root). Idempotent on duplicate id. |
| `stream` | `{ seq, target, chunk }` | Append `chunk` (Markdown or `.htmd` fragment) to the region with id `target`. |
| `region-done` | `{ seq, id }` | Finalize and seal the region and its actual descendants. New appends or child regions beneath a sealed ancestor are rejected. |
| `region-replace` | `{ seq, id, body }` | Replace the entire body, tear down actual descendants, and reopen the region. Ancestors and document must remain open. Local interaction state is intentionally discarded. |
| `doc-done` | `{ seq, id }` | Finalize all remaining regions and close the document. The ID must match an explicit `doc-open`. |
| `error` | `{ seq, message, recoverable, region? }` | Surface an error scoped to a region (or document if no `region`). |

Every event carries a monotonic `seq` integer per document. Consumers skip events at or below the last accepted `seq`, including replay after completion. Invalid event shapes, unsupported versions, and lifecycle rejections return `false` without advancing the sequence. This requires ordered delivery; it does not recover events delivered out of order.

`doc-open` accepts only `schemaVersion: "0.1"`. A document may open once; call `reset()` before a new document or after a fatal error. For direct fragment rendering, an implicit context without `doc-open` remains supported. A later explicit open cannot replace an active implicit context.

The renderer emits final `RegionUpdated` diagnostics before `RegionDone` and emits `DocDone` after finalizing remaining regions. A fatal `error` terminates mutation without falsely marking the document complete. Actual parentage governs finalization and replacement; explicit parent cycles are rejected.

### Limits

Renderers bound each document. The reference renderer's defaults (`DEFAULT_RENDER_LIMITS`, overridable per renderer):

| Limit | Default |
|---|---|
| `maxRegions` | 1000 regions |
| `maxRegionDepth` | 32 levels |
| `maxRegionBytes` | 1,000,000 bytes of source per region |
| `maxDocumentBytes` | 4,000,000 bytes of source per document |

An event that would exceed a limit is rejected, a non-recoverable error is emitted, and the document closes. Component payloads have their own bounds (§5).

### Example — a single AI message

```
{"type":"doc-open","seq":0,"id":"doc-1","schemaVersion":"0.1"}
{"type":"region","seq":1,"id":"$.msg","tag":"chat-message","attrs":{"author":"agent"}}
{"type":"stream","seq":2,"target":"$.msg.body","chunk":"Working on it…"}
{"type":"stream","seq":3,"target":"$.msg.body","chunk":"\n\n## Result\n\n<data-table src=\"/api/x\"/>"}
{"type":"region-done","seq":4,"id":"$.msg.body"}
{"type":"region-done","seq":5,"id":"$.msg"}
{"type":"doc-done","seq":6,"id":"doc-1"}
```

### Properties that fall out

- **Out-of-order materialisation.** A producer can declare regions A, B, C up front (skeleton paint) then stream body content into C before A is finished.
- **Resumability support.** A host reconnects with the last accepted `seq` and a producer replays events. Automatic transport reconnection and persistent logs are host responsibilities.
- **Replayable instructions.** Replaying an ordered log rebuilds the document structure. Fetched data and user choices are not immutable snapshots.
- **Multiple producers, one document.** Producers can fill independent regions if a host merges their events into a single ordered sequence.

### Rendering and adapter behavior

Streaming appends reconcile the affected region instead of replacing every DOM child. Unchanged component instances retain shadow DOM, focused drafts, selected choices, loaded data, and runtime-reflected attributes. Reconciliation is positional, not a keyed-movement algorithm. Attribute updates follow ownership (§4.5).

The parser reparses the accumulated region buffer on every chunk; HTMD is not a fully incremental Markdown parser. The renderer skips unchanged blocks, reconciles changed Markdown DOM, and renders the streaming frontier provisionally (§2).

The React hook accepts decoded event iterables, decoded `ReadableStream<WireEvent>` instances, and EventSource JSON messages. It reports `done` only after an accepted `doc-done`; nonempty finite streams ending earlier report interruption. Empty streams remain idle. Completion/fatal errors stop consumption. Cleanup cancels owned readers and removes listeners without closing a caller-owned EventSource. Source replacement resets prior document/error state.

## 4. Components and contracts

### 4.1 Contract model

A component contract (`ComponentContract` in `@htmdjs/contracts`) is the executable description of one component:

| Field | Meaning |
|---|---|
| `tag` | Custom-element tag name (contains a hyphen). |
| `version` | Positive integer; see §7. |
| `description` | What the component is for. |
| `attributes` | Declared attributes. Each has a `description`, a schema validating the complete string value, `required`, `ownership` (§4.5), and, for URL-valued attributes, a `url` purpose (§4.2). |
| `children` | `none`: no content; non-whitespace children are dropped. `text`: raw text payload, never parsed. `markdown`: Markdown only; nested components are dropped. `flow`: Markdown plus any component the host catalog allows. `components`: only the listed components; other content is dropped. |
| `partial` | `progressive` or `complete` (§4.4). |
| `partialBehavior` | What readers see while the component, its children, or its data are incomplete. |
| `state` | Which runtime state the user or component owns, and what resets it. |
| `events` | Public intents with typed details (§4.6). |
| `effects` | Declared side effects: `load-data`, `load-image`, `navigate`, `download`, `clipboard`, `emit-intent`. Effects that reach the network go through the host. |
| `accessibility` | Roles, labelling, and keyboard behavior. |
| `examples` | Complete, valid sources. |
| `validate` | Optional rules spanning attributes or children. |

### 4.2 Host control

The host is `{ components, authorizeUrl, loadData }`.

- **Catalog availability, not global registration.** `components` is a `ComponentCatalog`. A renderer instantiates only components in its host's catalog. Registration in the browser's custom-element registry is not permission: other custom elements render as a text fallback (§4.3). Hosts narrow the base catalog (`without`) or add their own contracts (`with`).
- **URL authorization per purpose.** Every URL a component loads or exposes passes one gate: scheme allowlist, resolution against the document base URL, `http:`/`https:` only for `data`, `image`, and `download`, then `authorizeUrl({ url, purpose, component, element })`. Purposes are `data`, `image`, `link`, and `download`, authorized separately.
- **Data is never authorized by default.** The default policy allows same-origin `image`, `link`, and `download` URLs and refuses every `data` URL. A model-written URL is not permission to fetch it; hosts opt in explicitly.
- **Data loading.** `loadData({ url, component, element, signal })` returns a complete payload or an async iterable of payload batches. `signal` aborts when the component is removed or its source changes. Without a loader, components fetch authorized `data` URLs as JSON. `<data-table>` accepts a complete `{ columns, rows }` payload or progressive batches: the first batch carries `columns`; each batch appends complete, validated rows.

Components obtain their host at effect time through a bubbling, composed DOM request, so the nearest provider governs components inside regions and inside other components' shadow trees. Standalone components use the default host: the base catalog, the default URL policy, and no loader.

### 4.3 Resolution

For each custom element the renderer resolves the contract from the host catalog. Precedence: availability → version pin → completeness → attributes → component rules.

- **Render.** The component is instantiated with validated, declared attributes only. **Unknown attributes are ignored** with a warning. Children follow the contract; disallowed children are dropped with a warning.
- **Defer.** A `complete`-policy component whose closing tag has not arrived is not instantiated. The renderer holds its position with exactly one placeholder, `<div data-htmd-deferred="{tag}" aria-busy="true">`, a styleable skeleton hook that is replaced by the component when its closing tag arrives.
- **Fallback.** The component is not instantiated. Causes: the tag is not in the catalog; `data-htmd-version` pins an unsupported version; a `complete`-policy component is still unclosed at finalization; a required attribute is missing; an attribute value fails its schema; or a component rule reports an error.

A fallback renders `<div data-htmd-fallback="{tag}">` and never instantiates components inside it. For a `text`-children contract it shows the raw text in a `<pre>`; otherwise it renders the Markdown found anywhere inside the element, with component wrappers flattened. Readers keep the content; nothing half-configured becomes interactive.

When a block's resolution kind or tag changes (for example, from defer to render, or render to fallback), its DOM is replaced.

### 4.4 Partial policies

- `progressive`: renders while its closing tag is still streaming. Available children render as they arrive.
- `complete`: not instantiated until its closing (or self-closing) tag arrives, so partial content is never interactive. While streaming it is deferred behind a `data-htmd-deferred` placeholder; if it is still unclosed when the region finalizes, it falls back with an `incomplete-component` error.

A component's data can also be partial: `<data-table>` shows validated row batches as they arrive, and incomplete rows never render.

### 4.5 State ownership

- `source`-owned attributes follow the source: later source changes are applied to the live element, and removed attributes are removed.
- `initial`-owned attributes are applied when the element is created. Afterwards the user or the component owns the value; source changes are neither re-applied nor removed.

Appending content never resets user-owned state. `region-replace` deliberately does: it replaces the region body and its components.

### 4.6 Intents

Components express user intent as DOM events that bubble and are composed, so hosts listen on any ancestor.

| Event | Detail | Emitted by |
|---|---|---|
| `choice` | `{ name, value, region? }` | `<choice-group>` when the user changes the selection. |
| `refine` | `{ target, prompt, region? }` | `<refine-prompt>` when the user submits a non-empty request. |

`region` is the ID of the nearest enclosing `data-htmd-region`, found across shadow roots, so hosts can attribute intents when several documents share a page. It is omitted outside regions. `target` is a region ID. Hosts handle intents; components never act on them.

### 4.7 Diagnostics

Renderers report `HtmdDiagnostic`s: parser diagnostics (`Diagnostic`) and contract diagnostics (`ContractDiagnostic`). All carry `severity` (`error` or `warning`), `code`, `message`, and a source span (`start`, `end`); contract diagnostics also carry the component `tag`.

| Contract code | Severity | Result |
|---|---|---|
| `unknown-component` | warning | fallback |
| `unsupported-component-version` | error | fallback |
| `incomplete-component` | error | fallback |
| `missing-attribute` | error | fallback |
| `invalid-attribute` | error | fallback |
| `unknown-attribute` | warning | attribute ignored |
| `disallowed-child` | warning | child ignored |
| `component-rule` | per rule | fallback on error |

Producers can validate before sending: parse with the host catalog's raw-text tags and run `validateNodes(nodes, catalog)`, which applies the renderer's resolution rules. Fallback content is text, so its descendants are not validated.

## 5. The base component set

`baseCatalog` holds nine component contracts (all version 1), implemented by `@htmdjs/elements` as Lit web components. Hosts may offer a subset or extend it. Lengths are in characters; URL attributes are non-empty and at most 2048 characters.

| Tag | Attributes (`*` required) | Children | Partial | Intents / effects |
|---|---|---|---|---|
| `<chat-message>` | `author`* (`user`, `agent`, `system`); `author-id`, `author-name` (non-blank, ≤128); `status` (`streaming`, `complete`, `failed`); `created-at` (ISO 8601 timestamp with offset) | flow | progressive | — |
| `<choice-group>` | `name`* (letter, then letters, digits, `_`, `-`; ≤64); `value` (initially selected value, ≤256; **initial**-owned) | `<choice-item>` only | progressive | `choice`; emit-intent |
| `<choice-item>` | `value`* (non-blank, ≤256) | Markdown (the label) | complete | — |
| `<code-block>` | `language` (letters, digits, `+`, `#`, `.`, `_`, `-`; ≤32); `show-copy` (`true` or `false`, default true) | raw text | progressive | clipboard |
| `<data-table>` | `src`* (URL, purpose `data`); `loading-text`, `empty-text`, `error-text` (≤200) | none | complete | load-data |
| `<file-preview>` | `name`* (non-blank, ≤256); `mime` (`type/subtype`); `size-bytes` (non-negative integer); `href` (URL, purpose `download`) | none | complete | download |
| `<image-card>` | `src`* (URL, purpose `image`); `alt`* (≤500); `width`, `height` (positive integers, pixels); `caption` (≤500) | none | complete | load-image |
| `<refine-prompt>` | `target`* (region ID such as `$.answer`); `placeholder` (≤120); `submit-label`, `working-label` (non-blank, ≤120) | none | complete | `refine`; emit-intent |
| `<htmd-fragment>` | `kind` (identifier, ≤64); `state` (JSON object, ≤65536) | raw text (JSON payload) | complete | — |

All attributes except `<choice-group value>` are source-owned. Component-specific behavior:

- **`<chat-message>`** is a message container: an article labelled by its author, `aria-busy` while `status="streaming"`. Producers update `status` as the message completes or fails. Nested components own their own state.
- **`<choice-group>`** is a single-selection radiogroup. Complete choices appear as they arrive; the current selection applies to choices that arrive later. Selection is user-owned: source changes to `value` after creation are ignored; region replacement resets it. One choice is in the tab order; arrow keys move focus and selection; Home/End jump to the ends. Duplicate choice values produce a warning.
- **`<choice-item>`** is one radio choice, not rendered until its closing tag arrives, so a user never selects a partially written option. Its selected state belongs to the group.
- **`<code-block>`** content is literal code: never Markdown, never components. It renders as it streams. Copy is a labelled button and copies only on user activation.
- **`<data-table>`** loads `src` only when the host authorizes `data` (blocked under the default host), through `loadData` when present. States: blocked, loading, partial, loaded, empty, interrupted, failed. Payloads and batches are validated before rendering; at most 5000 rows render and truncation is reported. Loaded data belongs to the element for its current `src`: changing `src`, replacing the region, or removing the element cancels outstanding loads, and late results are discarded. Native table with header cells; state changes are announced politely.
- **`<file-preview>`** shows a file reference; the download link, labelled with the file name, appears only when the host authorizes `href` for `download`.
- **`<image-card>`** reserves space from `width` and `height` before the image loads. The image loads only when the host authorizes `src` for `image`; otherwise the alt text is shown.
- **`<refine-prompt>`** is a labelled textarea and submit button attached to the region in `target`. Draft text, selection, focus, and submission state are user-owned and survive streaming and finalization. Submitting a non-empty request emits `refine` and keeps the form disabled until the host calls `reset(clearInput?)`.
- **`<htmd-fragment>`** renders a structured JSON node tree (below). It renders only after its closing tag arrives and the complete payload validates; partial JSON never renders, and an invalid complete payload falls back.

### `<htmd-fragment>` payload

```htmd
<htmd-fragment kind="card" state="{&quot;title&quot;:&quot;Q4&quot;,&quot;items&quot;:[&quot;Revenue up&quot;,&quot;Churn flat&quot;]}">
  {
    "tag": "div",
    "class": "card",
    "children": [
      { "tag": "h3", "text": "{{title}}" },
      {
        "tag": "ul",
        "children": [
          { "for": "item in items", "tag": "li", "text": "{{item}}" }
        ]
      }
    ]
  }
</htmd-fragment>
```

- **Node shape:** `{ tag, class?, text?, for?, attrs?, children? }`. The complete payload must be valid JSON of this shape.
- **State attribute:** `state="{...}"` — a JSON object, the scope for interpolation and loops.
- **Interpolation:** `{{key}}` — flat lookups on the scope. Values are HTML-escaped.
- **Loops:** `for="item in list"` on any node repeats it for each item of `list` from the scope.
- **Allowed tags:** native `div`, `span`, `h2`, `h3`, `h4`, `ul`, `ol`, `li`, `img`, `a`, plus components the host catalog resolves to render (validated attributes only). Registration alone is not enough.
- **Per-tag attribute allowlist** on native tags. `on*` attributes are always dropped. URL attributes pass the shared URL gate; native `img` sources are authorized as `image` and `a` links as `link`.
- **Bounded:** 32 max render depth, 1000 max loop items.
- **No template strings, no eval.** Payloads are structured intent, parsed then interpreted.

## 6. Security model

The single hard rule: **producers never emit code that executes in the consumer.**

- No `<script>`, `<style>`, `<iframe>`, `<object>`, `<embed>`, `<link>`, `<meta>`, `<base>`, `<form>` tags.
- No `javascript:` URLs. Tab/newline scheme-splitting (`java\tscript:`) is rejected by the shared URL sanitizer.
- No `data:` URLs (any MIME).
- No `on*` inline event handlers on any element.
- Component attributes are strings validated by their contract; undeclared attributes never reach the component.
- `<htmd-fragment>` payloads use a restricted JSON DSL with allowlisted tags and binding expressions, parsed not evaluated.
- Every component URL passes the host's per-purpose authorization. Data is never loaded without explicit host permission.

**Consumer requirement:** the Markdown renderer must never enable raw HTML. `@htmdjs/renderer` uses micromark with raw HTML escaped and `javascript:` links stripped; consumers who plug in a different renderer must match that posture.

List only trusted component contracts in a catalog and register only trusted implementations: their code controls attribute semantics, requests, and side effects. A hyphenated name and parser diagnostics do not sandbox arbitrary components. Hosts must enforce authorization and safe endpoint policy even for same-origin data requests.

## 7. Versioning

- `schemaVersion` on `doc-open` declares the wire format version. `0.1` is the current value.
- Major bumps are breaking (consumers reject unknown versions).
- Components are versioned per contract. Source may pin a version with `data-htmd-version`; a pin other than the host's contract version renders a fallback with `unsupported-component-version`. All base contracts are version 1.

## 8. Reference implementation

This repository.

- [`@htmdjs/contracts`](../packages/contracts) — component contracts, catalogs, hosts, intents, payload schemas, and validation.
- [`@htmdjs/parser`](../packages/parser) — parse source into AST, pending state, and diagnostics.
- [`@htmdjs/wire`](../packages/wire) — event-shape validation and producer helpers that number events and turn streamed text into a complete document.
- [`@htmdjs/elements`](../packages/elements) — base component implementations.
- [`@htmdjs/renderer`](../packages/renderer) — contract-enforcing, state-preserving DOM rendering and protocol lifecycle.
- [`@htmdjs/react`](../packages/react) — static documents and stream lifecycle adapter.
- [`@htmdjs/core`](../packages/htmd) — meta package.

## 9. Non-goals

- `.htmd` is not a Markdown extension to standardise. CommonMark + GFM are fine.
- `.htmd` is not a general markup language or component framework. It is a streaming document contract, expressed as Markdown plus host-controlled components.
- `.htmd` is not opinionated about the host application — it works in chat clients, IDE panels, dashboards, notebooks, anywhere a producer can emit and a consumer can render.

---

For the model-facing spec suitable for a system prompt, see [`AI_SPEC.md`](../AI_SPEC.md).
