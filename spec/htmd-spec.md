# `.htmd` Specification

**Status:** pre-alpha. Subject to change.
**Version:** 0.0.0

## 1. What `.htmd` is

`.htmd` is a streamable document format for AI output. Two ideas stacked:

1. **Markdown is the floor, HTML is the ceiling.** Models speak markdown well. Markdown handles prose, headings, lists, code, basic tables, links, emphasis. When the model needs to express something markdown can't (tabs, columns, choices, tools, diffs, embedded artefacts), it uses HTML *custom elements* (web components). Plain HTML elements (`<p>`, `<strong>`, `<ul>`) are forbidden — markdown does those.

2. **The wire format treats AI output as a live document tree.** Each renderable region is addressable. Regions can stream in parallel, fill out-of-order, be replaced mid-stream, and resume after disconnect. The wire log *is* the artefact — replay it tomorrow and you get the same document.

## 2. The format on disk

A `.htmd` document is a UTF-8 string. It looks like markdown with custom-element escape hatches:

```htmd
Looking at the data now.

<data-table src="/api/sales/q4" sort="revenue:desc" page-size="10"/>

## Recommendation

Three options, pick one:

<choice-group name="next-step">
  <choice value="dig-deeper">Dig into the top performer</choice>
  <choice value="export">Export the table</choice>
  <choice value="another-cut">Show me a different cut</choice>
</choice-group>
```

### Markdown surface

CommonMark + GFM (tables, strikethrough, task lists, autolinks, fenced code). Inline HTML is restricted to **custom elements only** — any tag containing a hyphen.

### Custom element surface

- Tag name must contain at least one hyphen (per the Custom Elements spec).
- Attributes follow standard HTML attribute syntax (kebab-case attribute names).
- Attribute values use double quotes.
- Children are either prose, more custom elements, or (for the special `<fragment>` element) a JSON payload.

### Forbidden

- Plain HTML elements (`<p>`, `<strong>`, `<ul>`, `<h1>`, `<a>`, etc.). Use markdown.
- `<script>`, inline event handlers (`onclick="..."`), `javascript:` URLs.
- Template strings or expression syntax in attribute values. Attributes are literal data, not code.

## 3. The wire protocol

`.htmd` documents stream over a connection (SSE, WebSocket, or any transport that preserves event order) as **region-addressed events**.

### Region IDs

Each addressable region has a hierarchical path identifier:

```
$.channel.msg.{message_id}            top-level message region
$.channel.msg.{message_id}.body       the body of that message
$.channel.msg.{message_id}.body.tool-call-1   nested region inside the body
```

The `$` is the document root. Segments after it are stable strings the producer chooses.

### Event vocabulary (minimum viable)

| Event | Payload | Effect |
|---|---|---|
| `doc-open` | `{id, schema_version}` | Open a document context. Consumer sets up its root region. |
| `region` | `{id, tag, parent?, attrs?}` | Declare a region. Allocates an element of `tag`, attaches to `parent` (default: document root). Idempotent on duplicate id. |
| `stream` | `{target, chunk}` | Append a chunk into the region with id `target`. Chunks are typically markdown or HTML fragments. Order-preserving. |
| `region-done` | `{id}` | Mark a region as complete. Consumer can finalise / commit / persist. |
| `region-replace` | `{id, body}` | Replace the entire body of a region. Used for sparse out-of-order updates or refinement. |
| `doc-done` | `{id}` | Close a document. |
| `error` | `{region?, message, recoverable}` | Surface an error scoped to a region (or document if no `region`). |

Each event also carries a monotonic `seq` integer per document, for resumability.

### Properties that fall out

- **Out-of-order materialisation.** A producer can declare regions A, B, C up front (skeleton paint) then stream body content into C before A is finished.
- **Resumability.** A consumer reconnects with `last_seen_seq`; producer replays from that seq. No re-parsing the whole stream.
- **Replay = render.** Persist the event log; play it back identically tomorrow.
- **Multiple producers, one document.** Two agents can stream into different regions of the same document concurrently. Useful for multi-agent chat.

## 4. The base element set

The `.htmd` ecosystem ships a reference set of Lit web components in `@htmd/elements`. The base set is small, opinionated, and stable. Consumers can extend with their own custom elements, but the base set is the lingua franca producers can rely on.

### Base elements (v0)

| Tag | Purpose |
|---|---|
| `<chat-message>` | Top-level message container. Carries author, timestamp, status (streaming/complete/failed). Children are body content. |
| `<data-table>` | Tabular data. Either inline `<rows>` or `src=""` for client-side fetch. Sort/filter/page affordances built in. |
| `<choice-group>` | Set of `<choice>` children. Renders as buttons or chips. Emits a `choice` event with the selected value. |
| `<code-block>` | Fenced code with language, copy button, optional line numbers, optional diff mode. |
| `<image-card>` | Image with caption, alt, configurable aspect ratio. Reserves space (zero CLS). |
| `<file-preview>` | File reference (path/URL/key, name, size, mime). Renders mime-appropriate preview (snippet for text, thumbnail for PDF, etc.). |
| `<refine>` | A re-prompt affordance attached to a region. Carries a target region id and a textarea; on submit, asks the producer to refine that region. |
| `<fragment>` | The escape hatch. Renders a JSON-described tree of safe sub-elements with one-way data binding. Used when no named element fits and the producer needs an ad-hoc layout. |

### `<fragment>` payload

```html
<fragment kind="card">
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
</fragment>
```

- **No template strings, no eval.** Bindings (`{{title}}`) are whitelisted expressions over the fragment's scoped state object.
- **Whitelisted tags only** inside a fragment payload — `div`, `span`, `h2`–`h4`, `ul`, `ol`, `li`, `img`, `a` (with restricted attrs), plus any registered custom element.
- **The AI never writes code that runs.** A fragment carries structured intent. The renderer interprets it.

## 5. Security model

The single hard rule: **producers never emit code that executes in the consumer.**

- No `<script>` tags.
- No `javascript:` URLs.
- No inline event handlers.
- No template strings in attribute values.
- Custom element attributes are strings; the element's TypeScript code decides what they mean.
- `<fragment>` payloads use a restricted JSON DSL with whitelisted tags + binding expressions, parsed not evaled.

This line is the entire reason `.htmd` is safe to render output from an arbitrary upstream agent.

## 6. Versioning

- `schema_version` on `doc-open` declares the wire format version.
- Major bumps are breaking (consumers reject unknown versions).
- Element set is versioned per-element via `data-htmd-version` if the element ships a v2.

## 7. Reference implementation

This repository.

- [`@htmd/parser`](../packages/parser) — parse `.htmd` source to AST.
- [`@htmd/elements`](../packages/elements) — Lit web components for the base element set.
- [`@htmd/pipe-protocol`](../packages/pipe-protocol) — Zod schemas for the wire event vocabulary.

## 8. Non-goals

- `.htmd` is not a markdown extension to standardise. CommonMark + GFM are fine.
- `.htmd` is not a markup language. It's a *streamable serialisation contract* for AI output, expressed as markdown + custom elements.
- `.htmd` is not opinionated about the host application — it works in chat clients, IDE panels, dashboards, notebooks, anywhere a producer can emit and a consumer can render.

---

For the full design conversation (decisions, alternatives considered, trade-offs), see the working spec.
