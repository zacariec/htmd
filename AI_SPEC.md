# `.htmd` — model spec

> **Hosts:** generate the system prompt with `modelInstructions(host.components)` from `@htmdjs/contracts` (also exported by `@htmdjs/core`). It describes only the components, children, and examples your host actually offers, so the model never writes a component that will render as plain text. This file is the full reference for the base component set.

Otherwise, drop this file into a system prompt. `.htmd` is a streaming document format: Markdown for prose, plus components from a library the host controls, used only when structure or interaction is required. Every component has a contract; content that breaks it is shown to the reader as plain text instead of a working component.

## Hard rules

- Prose in **Markdown** only. Never emit `<p>`, `<strong>`, `<em>`, `<ul>`, `<ol>`, `<li>`, `<h1>`–`<h6>`, `<a>`, `<img>`, `<blockquote>`, or `<table>` — Markdown handles them.
- **Only use components the host lists.** The base set below is the default; a host may offer fewer or more. Any other tag renders as plain text.
- Use only the attributes listed for each component. Unknown attributes are ignored.
- Give every required attribute (marked `*`) a valid value. A missing or invalid attribute turns the component into plain text:
  - `<choice-item>` needs a non-empty `value`, unique within its group.
  - `<image-card>` needs `alt` (and `src`).
  - `<refine-prompt>` `target` must be a region ID such as `$.answer` — `$` followed by dot-separated segments of letters, digits, `_`, or `-`.
  - `<data-table>` needs `src`; `<file-preview>` needs `name`; `<chat-message>` needs `author`; `<choice-group>` needs `name`.
- `<code-block>` content is literal: it is shown exactly as written, never as Markdown or components. Do not escape it.
- `<htmd-fragment>` content must be one complete, valid JSON node. Partial or invalid JSON never renders.
- Attribute values are double-quoted strings. Encode `"` inside a value as `&quot;`.
- Close every non-self-closing tag. Choices, images, files, tables, refine prompts, and fragments appear only after their tag is complete, so finish each one promptly.
- Nest components at most 64 levels deep.
- No `<script>`, `<style>`, `<iframe>`, `<object>`, `<embed>`, `<link>`, `<meta>`, `<base>`, `<form>`.
- No `on*` handlers, no `javascript:` URLs, no `data:` URLs.
- A URL is a request, not permission. The host decides which images, links, downloads, and data may load. Do not invent data endpoints; use ones the host gave you.
- Prefer three-backtick code fences. To show a component literally without rendering it, put it inside a fence or inline code span.
- Chunks may end inside tags. The consumer buffers incomplete tag syntax; finish all tags and code fences before declaring completion.

## Base components

Each entry: `tag(attrs)` — `*` marks required attributes. Lengths are in characters.

### `<chat-message author* author-id? author-name? status? created-at?>`
A message container. `author` is `user`, `agent`, or `system`. `status` is `streaming`, `complete`, or `failed`. `created-at` is an ISO 8601 timestamp with offset. Children are Markdown and components.
```
<chat-message author="agent" author-name="Navigator" status="complete" created-at="2026-09-23T09:15:00Z">

Working on it now.

</chat-message>
```

### `<data-table src*/>`
A table loaded by the host from `src` (`{ columns: string[], rows: object[] }`). The host must allow the data URL; otherwise the table shows as blocked. Optional `loading-text`, `empty-text`, `error-text` (≤200). Self-closing.
```
<data-table src="/api/sales/q4"/>
```

### `<choice-group name*>` + `<choice-item value*>`
A single-selection choice. `name` starts with a letter, then letters, digits, `_`, or `-` (≤64). Items contain only a Markdown label; the group contains only items. Selecting emits a `choice` event to the host. Optional group `value` preselects a choice.
```
<choice-group name="next-step">
  <choice-item value="dig">Dig into the top performer</choice-item>
  <choice-item value="export">Export the table</choice-item>
</choice-group>
```

### `<code-block language? show-copy?>`
Literal code with an optional copy button. `language` is a short label such as `ts` or `c++`; `show-copy` is `true` or `false`. The content is the code.
```
<code-block language="ts">const total = cart.lines.reduce((sum, line) => sum + line.priceCents, 0);</code-block>
```

### `<image-card src* alt* width? height? caption?/>`
An image with alternative text. Give `width` and `height` in pixels when known so space is reserved before it loads. Self-closing.
```
<image-card src="/charts/q4.png" alt="Q4 revenue by week" width="1200" height="675" caption="Weekly revenue, w40-w52"/>
```

### `<file-preview name* mime? size-bytes? href?/>`
A file reference with an optional download link. `mime` looks like `application/pdf`; `size-bytes` is a whole number. Self-closing.
```
<file-preview name="q4-full-report.pdf" mime="application/pdf" size-bytes="482133" href="/files/q4-full-report.pdf"/>
```

### `<refine-prompt target* placeholder? submit-label? working-label?/>`
A revision box for the region named by `target`. Submitting sends the host a `refine` event with `{ target, prompt }`. Self-closing.
```
<refine-prompt target="$.answer"/>
```

### `<htmd-fragment kind? state?>`
The escape hatch. Use only when no named component fits. The content is one JSON node; `state` is a JSON object (HTML-encode its quotes).

Node shape: `{ tag, class?, text?, for?, attrs?, children? }`.
- Allowed native tags: `div`, `span`, `h2`–`h4`, `ul`, `ol`, `li`, `img`, `a`, plus components the host lists.
- `text` interpolates `{{key}}` from `state`.
- `for: "item in list"` repeats a node for each item of a list in `state` (at most 1000).
- URL attributes (`src`, `href`) are checked by the host. `on*` and `style` are dropped.

```
<htmd-fragment kind="card" state="{&quot;title&quot;:&quot;Highlights&quot;,&quot;items&quot;:[&quot;w51 best&quot;,&quot;w49 worst&quot;]}">
  {
    "tag": "div",
    "class": "card",
    "children": [
      { "tag": "h3", "text": "{{title}}" },
      { "tag": "ul", "children": [
        { "for": "item in items", "tag": "li", "text": "{{item}}" }
      ]}
    ]
  }
</htmd-fragment>
```

## Wire events (only when the producer emits over a stream)

One JSON object per event. `seq` is monotonic per document.

| Event | Shape |
|---|---|
| `doc-open` | `{ type, seq, id, schemaVersion }` |
| `region` | `{ type, seq, id, tag, parent?, attrs? }` |
| `stream` | `{ type, seq, target, chunk }` |
| `region-done` | `{ type, seq, id }` |
| `region-replace` | `{ type, seq, id, body }` |
| `doc-done` | `{ type, seq, id }` |
| `error` | `{ type, seq, message, recoverable, region? }` |

Region ids are `$`-rooted dot paths: `$.msg.body.tool-1`. Declare regions first, `stream` Markdown and components into them, `region-done` when finished, `region-replace` for revisions.

- Open with `schemaVersion: "0.1"` and finish with `doc-done` using the same document ID.
- `region-done` seals the region and its actual descendants. Do not append to a sealed region or create children beneath it.
- `region-replace` is the explicit revision operation: it removes descendants and reopens that region while its ancestors and document are still open.
- After `doc-done` or a fatal error, start a new consumer context; do not continue the old document.
- Use globally increasing `seq` values on an ordered transport. Replays are ignored; independent producers need a shared sequencer.
- Stay within the host's limits (by default 1000 regions, region depth 32, 1 MB per region, 4 MB per document). Exceeding one ends the document.
- The reader sees Markdown as it streams: unambiguous syntax is shown early, ambiguous syntax waits, and a half-written link is never clickable. Still close emphasis, links, and code fences promptly; the final document uses ordinary Markdown semantics.
- Point `<refine-prompt target>` at a region you declared. Choice/refine events are handled by the host and report the region they came from. Replacing a region intentionally discards its local interaction state; appending prose does not.

## Anti-patterns

- Wrap prose in `<div>` / `<span>` — use Markdown.
  - ✗ `<div>Hello **world**</div>`
  - ✓ `Hello **world**`
- Emit `<button>` / `<input>` — use `<choice-group>` / `<refine-prompt>` / `<htmd-fragment>`.
- Paste a large table as HTML — use `<data-table src>` with an endpoint the host provides.
- Encode structured intent as prose — use `<htmd-fragment>` with a real node.
- Rely on JS in the payload — `<htmd-fragment>` is pure data.
- Invent attributes (`sort`, `page-size`, `style`) — they are ignored.
- Refine a prose description (`target="the answer"`) — use a region ID (`target="$.answer"`).

## Worked example

````
Looking at Q4 now.

## What the data says

- Revenue **up 12%** QoQ
- Churn flat at 2.1%
- One outlier (w49), traced to a billing bug

The fix, for reference:

```ts
const corrected = invoices.filter((invoice) => !invoice.voided);
```

<data-table src="/api/sales/q4"/>

<image-card src="/charts/q4-revenue.png" alt="Weekly revenue w40-w52" width="1200" height="675" caption="Weekly revenue, w40-w52"/>

## Next

<choice-group name="direction">
  <choice-item value="forecast">Build the Q1 forecast</choice-item>
  <choice-item value="deep-dive">Deep-dive on w49</choice-item>
</choice-group>

<refine-prompt target="$.msg.body"/>
````
