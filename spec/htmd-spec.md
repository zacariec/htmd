# `.htmd` Specification

**Status:** 0.1 alpha.
**Version:** `0.1.0-alpha.1`

## 1. What `.htmd` is

`.htmd` is a streamable document format for AI output. Two ideas stacked:

1. **Markdown is the floor, HTML is the ceiling.** Models speak markdown well. Markdown handles prose, headings, lists, code, basic tables, links, emphasis. When the model needs to express something markdown can't (columns, choices, tools, diffs, embedded artefacts), it uses HTML *custom elements* (web components). Plain HTML elements (`<p>`, `<strong>`, `<ul>`) are forbidden — markdown does those.

2. **The wire format treats AI output as a live document tree.** Each renderable region is addressable. Regions can fill independently, be replaced mid-stream, and accept replay after reconnect. The event log reproduces document instructions; external URLs and user interaction state require separate snapshotting if historical reproduction is needed.

## 2. The format on disk

A `.htmd` document is a UTF-8 string. It looks like markdown with custom-element escape hatches:

```htmd
Looking at the data now.

<data-table src="/api/sales/q4" sort="revenue:desc" page-size="10"/>

## Recommendation

Three options, pick one:

<choice-group name="next-step">
  <choice-item value="dig-deeper">Dig into the top performer</choice-item>
  <choice-item value="export">Export the table</choice-item>
  <choice-item value="another-cut">Show me a different cut</choice-item>
</choice-group>
```

### Markdown surface

CommonMark + GFM (tables, strikethrough, task lists, autolinks, fenced code). Inline HTML is restricted to **custom elements only** — any tag containing a hyphen.

### Custom element surface

- Tag name must contain at least one hyphen (per the Custom Elements spec).
- Attributes follow standard HTML attribute syntax (kebab-case attribute names).
- Attribute values use double quotes. Single quotes are accepted with a warning diagnostic.
- Children are either prose, more custom elements, or (for the `<htmd-fragment>` element) a JSON payload.

### Forbidden

- Plain HTML elements (`<p>`, `<strong>`, `<ul>`, `<h1>`, `<a>`, etc.). Use markdown.
- `<script>`, `<style>`, `<iframe>`, `<object>`, `<embed>`, `<link>`, `<meta>`, `<base>`, `<form>`. Reported as error diagnostics.
- Inline event handlers (`onclick="…"` and any `on*=` attribute). Reported as error diagnostics.
- `javascript:` URLs (in attribute values or markdown link targets). Reported as error diagnostics.
- Template strings or expression syntax in attribute values. Attributes are literal data, not code.

### Partial-source rendering

`Parser.parse(source, { streaming: true })` retains the complete input in `document.source`, withholds plausible incomplete tag suffixes from renderable nodes, and returns `pending: true` for known unfinished tag/code syntax or open custom elements. Open elements render available children without premature missing-close diagnostics. Complete prose is not marked pending merely because the transport remains open.

Final parsing (`Parser.parse(source)`) clears `pending`, preserves unfinished custom syntax as literal Markdown with diagnostics, and reports missing closing tags. Unexpected closing tags remain literal rather than disappearing. Fences and inline code do not instantiate custom elements.

Markdown stays provisional: unfinished emphasis can remain literal and later reference definitions can affect earlier output. No synthetic delimiters or URL destinations are invented. The renderer marks known pending source with `data-htmd-pending`; this is not an exhaustive detector of unfinished Markdown.

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

### Event vocabulary

| Event | Payload | Effect |
|---|---|---|
| `doc-open` | `{ seq, id, schemaVersion }` | Open a document context. Consumer sets up its root region. |
| `region` | `{ seq, id, tag, parent?, attrs? }` | Declare a region. Allocates an element of `tag`, attaches to `parent` (default: the region at the id's path prefix, else root). Idempotent on duplicate id. |
| `stream` | `{ seq, target, chunk }` | Append `chunk` (markdown or `.htmd` fragment) to the region with id `target`. |
| `region-done` | `{ seq, id }` | Finalize and seal the region and its actual descendants. New appends or child regions beneath a sealed ancestor are rejected. |
| `region-replace` | `{ seq, id, body }` | Replace the entire body, tear down actual descendants, and reopen the region. Ancestors and document must remain open. Local interaction state is intentionally discarded. |
| `doc-done` | `{ seq, id }` | Finalize all remaining regions and close the document. The ID must match an explicit `doc-open`. |
| `error` | `{ seq, message, recoverable, region? }` | Surface an error scoped to a region (or document if no `region`). |

Every event carries a monotonic `seq` integer per document. Consumers skip events at or below the last accepted `seq`, including replay after completion. Invalid event shapes, unsupported versions, and lifecycle rejections return `false` without advancing the sequence. This requires ordered delivery; it does not recover events delivered out of order.

`doc-open` accepts only `schemaVersion: "0.1"`. A document may open once; call `reset()` before a new document or after a fatal error. For direct fragment rendering, an implicit context without `doc-open` remains supported. A later explicit open cannot replace an active implicit context.

The renderer emits final `RegionUpdated` diagnostics before `RegionDone` and emits `DocDone` after finalizing remaining regions. A fatal `error` terminates mutation without falsely marking the document complete. Actual parentage governs finalization and replacement; explicit parent cycles are rejected.

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

Streaming appends reconcile the affected region instead of replacing every DOM child. Unchanged custom-element instances retain shadow DOM, focused drafts, selected choices, loaded data, and runtime-reflected attributes. Changes to source-owned attributes remain authoritative. Reconciliation is positional, not a keyed-movement algorithm.

The current parser still reparses the accumulated region buffer. The renderer skips unchanged blocks and reconciles changed Markdown DOM; it is not a fully incremental Markdown parser.

The React hook accepts decoded event iterables, decoded `ReadableStream<WireEvent>` instances, and EventSource JSON messages. It reports `done` only after an accepted `doc-done`; nonempty finite streams ending earlier report interruption. Empty streams remain idle. Completion/fatal errors stop consumption. Cleanup cancels owned readers and removes listeners without closing a caller-owned EventSource. Source replacement resets prior document/error state.

## 4. The base element set

`@htmdjs/elements` ships nine Lit web components. Consumers can extend with their own trusted custom elements; the base set is the vocabulary producers can rely on.

### Base elements

| Tag | Purpose |
|---|---|
| `<chat-message>` | Top-level message container. Carries `author`, `author-id`, `author-name`, `status` (`streaming` / `complete` / `failed`), `created-at`. Children are body content. |
| `<data-table>` | Tabular data fetched from `src`. Payload shape: `{ columns: string[], rows: Record<string, unknown>[] }`. Fetch policy is same-origin by default; consumers override via the static `DataTable.urlPolicy` hook. Invalid payloads show the error state. |
| `<choice-group>` | Wraps `<choice-item>` children. Emits a `choice` event with `{ name, value }` when a child is picked. Sets `role="radiogroup"`. |
| `<choice-item>` | Renders a button; dispatches the internal `choice-select` event to its parent group. Sets `role="radio"` and `aria-checked`. |
| `<code-block>` | Fenced code with `language`, `show-copy`, and a slot for the source. |
| `<image-card>` | Image with `src`, `alt`, `width`, `height`, `caption`. Reserves aspect-ratio space (zero CLS) when width and height are set. `javascript:` and `data:` URLs are stripped. |
| `<file-preview>` | File reference (`name`, `mime`, `size-bytes`, `href`). Mime-appropriate icon; download link when `href` passes the URL allowlist. |
| `<refine-prompt>` | Textarea + submit attached to a region. On submit dispatches a `refine` event with `{ target, prompt }` and disables itself. Consumer calls `element.reset(clearInput?: boolean)` when the round-trip finishes. |
| `<htmd-fragment>` | The escape hatch. Renders a JSON-described tree of safe sub-elements with one-way data binding. Used when no named element fits. |

### `<htmd-fragment>` payload

```html
<htmd-fragment kind="card">
  {
    "tag": "div",
    "class": "p-4 rounded bg-zinc-900",
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

- **Node shape:** `{ tag, class?, text?, for?, attrs?, children? }`. Validated with Zod.
- **State attribute:** `state="{...}"` — JSON, becomes the scope object for interpolation and loops.
- **Interpolation:** `{{key}}` — flat lookups on the scope. Values are HTML-escaped.
- **Loops:** `for="item in list"` on any node; the parent must not carry both `for` and a normal `children` list on the same node.
- **Whitelisted tags:** `div`, `span`, `h2`, `h3`, `h4`, `ul`, `ol`, `li`, `img`, `a`, plus any registered custom element in the document's registry.
- **Per-tag attribute allowlist** on native tags. `on*` attributes always dropped. URL attributes (`src`, `href`, `action`, `formaction`, `poster`) go through the shared `sanitizeUrl` gate.
- **Bounded:** 32 max render depth, 1000 max loop items.
- **No template strings, no eval.** Payloads are structured intent, parsed then interpreted.
- **Streaming.** The fragment re-parses its light-DOM text on mutation, so payloads streamed in via `.htmd` chunks materialise as soon as the JSON becomes valid.

## 5. Security model

The single hard rule: **producers never emit code that executes in the consumer.**

- No `<script>`, `<style>`, `<iframe>`, `<object>`, `<embed>`, `<link>`, `<meta>`, `<base>`, `<form>` tags.
- No `javascript:` URLs. Tab/newline scheme-splitting (`java\tscript:`) is rejected by the shared URL sanitizer.
- No `data:` URLs (any MIME).
- No `on*` inline event handlers on any element.
- Custom-element attributes are strings; the element's TypeScript decides what they mean.
- `<htmd-fragment>` payloads use a restricted JSON DSL with whitelisted tags + binding expressions, parsed not evaled.

**Consumer requirement:** the markdown renderer must never enable raw HTML. `@htmdjs/renderer` uses micromark with raw HTML escaped and `javascript:` links stripped; consumers who plug in a different renderer must match that posture.

Register only trusted custom-element implementations: their code controls attribute semantics, requests, and side effects. A hyphenated name and parser diagnostics do not sandbox arbitrary components. Hosts must enforce authorization and safe endpoint policy even for same-origin data requests.

## 6. Versioning

- `schemaVersion` on `doc-open` declares the wire format version. `0.1` is the current value.
- Major bumps are breaking (consumers reject unknown versions).
- Element set is versioned per-element via `data-htmd-version` if an element ships a v2.

## 7. Reference implementation

This repository.

- [`@htmdjs/parser`](../packages/parser) — parse source into AST, pending state, and diagnostics.
- [`@htmdjs/wire`](../packages/wire) — event-shape validation.
- [`@htmdjs/elements`](../packages/elements) — built-in components.
- [`@htmdjs/renderer`](../packages/renderer) — state-preserving DOM rendering and protocol lifecycle.
- [`@htmdjs/react`](../packages/react) — static documents and stream lifecycle adapter.
- [`@htmdjs/core`](../packages/htmd) — meta package.

## 8. Non-goals

- `.htmd` is not a markdown extension to standardise. CommonMark + GFM are fine.
- `.htmd` is not a markup language. It's a *streamable serialisation contract* for AI output, expressed as markdown + custom elements.
- `.htmd` is not opinionated about the host application — it works in chat clients, IDE panels, dashboards, notebooks, anywhere a producer can emit and a consumer can render.

---

For the model-facing spec suitable for a system prompt, see [`AI_SPEC.md`](../AI_SPEC.md).
