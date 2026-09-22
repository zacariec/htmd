# `.htmd` — model spec

Drop into a system prompt. `.htmd` is a document format for AI output: markdown for prose, custom HTML elements only when structure or interactivity is required.

## Hard rules

- Prose in **markdown** only. Never emit `<p>`, `<strong>`, `<em>`, `<ul>`, `<ol>`, `<li>`, `<h1>`–`<h6>`, `<a>`, `<img>`, `<blockquote>`, or `<table>` — markdown handles them.
- Only tags with a hyphen are legal HTML (custom elements). Use the base set below or `<htmd-fragment>`.
- Attribute values are double-quoted strings.
- Every non-self-closing tag must be closed.
- No `<script>`, `<style>`, `<iframe>`, `<object>`, `<embed>`, `<link>`, `<meta>`, `<base>`, `<form>`.
- No `on*` handlers, no `javascript:` URLs, no `data:` URLs.
- Prefer three-backtick code fences. To show a custom-element literal without rendering it, put it inside a fence or inline code span.
- Chunks may end inside tags. The consumer buffers incomplete tag syntax; finish all tags and code fences before declaring completion.

## Base elements

Each entry: `tag(attrs) — children`.

### `<chat-message author author-id? author-name? status? created-at?/>`
Wraps a message. `author` is `user`/`agent`/`system`. `status` is `streaming`/`complete`/`failed`. Children are body content.
```
<chat-message author="agent" author-name="Navigator" status="complete" created-at="2026-08-01T09:15:00Z">
  Working on it now.
</chat-message>
```

### `<data-table src/>`
Fetches JSON `{ columns: string[], rows: object[] }` from `src`. Same-origin only unless the host opted in. Self-closing.
```
<data-table src="/api/sales/q4"/>
```

### `<choice-group name>` + `<choice-item value>`
A radio-style choice. Group emits a `choice` event. `value` is required on items.
```
<choice-group name="next-step">
  <choice-item value="dig">Dig into the top performer</choice-item>
  <choice-item value="export">Export the table</choice-item>
</choice-group>
```

### `<code-block language? show-copy?>`
A code sample with header + optional copy button. Put the code in the slot.
```
<code-block language="ts">
const total = cart.lines.reduce((sum, line) => sum + line.priceCents, 0);
</code-block>
```

### `<image-card src alt width height caption?/>`
Image with reserved aspect ratio. **`width` and `height` are required** — CLS depends on them. Self-closing.
```
<image-card src="/charts/q4.png" alt="Q4 revenue" width="1200" height="675" caption="Weekly revenue, w40-w52"/>
```

### `<file-preview name mime size-bytes? href?/>`
A file reference with a download link. Self-closing.
```
<file-preview name="q4-full-report.pdf" mime="application/pdf" size-bytes="482133" href="/files/q4-full-report.pdf"/>
```

### `<refine-prompt target placeholder? submit-label? working-label?></refine-prompt>`
Attaches a textarea to a region id. On submit, emits a `refine` event with `{ target, prompt }`.
```
<refine-prompt target="$.msg.body"></refine-prompt>
```

### `<htmd-fragment kind state?>`
The escape hatch. Body is a JSON payload the renderer walks. Use only when no named element fits.

Node shape: `{ tag, class?, text?, for?, attrs?, children? }`.
- Whitelisted native tags: `div`, `span`, `h2`–`h4`, `ul`, `ol`, `li`, `img`, `a` (+ any registered custom element).
- `text` interpolates `{{key}}` from the fragment's `state`.
- `for="item in list"` loops (list resolved from `state`), bounded at 1000 items.
- URL attributes (`src`, `href`) sanitized. `on*` and `style` dropped.

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

Region ids are `$`-rooted dot paths: `$.msg.body.tool-1`. Declare regions first, `stream` markdown/HTML into them, `region-done` when finished, `region-replace` for revisions.

- Open with `schemaVersion: "0.1"` and finish with `doc-done` using the same document ID.
- `region-done` seals the region and its actual descendants. Do not append to a sealed region or create children beneath it.
- `region-replace` is the explicit revision operation: it removes descendants and reopens that region while its ancestors and document are still open.
- After `doc-done` or a fatal error, start a new consumer context; do not continue the old document.
- Use globally increasing `seq` values on an ordered transport. Replays are ignored; independent producers need a shared sequencer.
- Standard Markdown is provisional until completion. Do not rely on incomplete emphasis/link syntax having a finalized appearance.
- Choice/refine events are handled by the host. Replacing a region intentionally discards its local interaction state; appending prose does not.

## Anti-patterns

- Wrap prose in `<div>` / `<span>` — use markdown.
  - ✗ `<div>Hello **world**</div>`
  - ✓ `Hello **world**`
- Emit `<button>` / `<input>` — use `<choice-group>` / `<refine-prompt>` / `<htmd-fragment>`.
- Repeat the same table with `<html>` — use `<data-table src>`.
- Encode structured intent as prose — use `<htmd-fragment>` with a real node.
- Rely on JS in the payload — `<htmd-fragment>` is pure data.

## Worked example

```
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

<refine-prompt target="$.msg.body"></refine-prompt>
```
