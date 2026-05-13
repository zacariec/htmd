# `.htmd`

A streamable HTML+Markdown wire format for AI output.

- **Markdown is the floor** — what models already do well.
- **HTML (custom elements) is the ceiling** — for structure and interactivity markdown can't express.
- **A wire protocol that treats AI output as a live document tree**, not a token stream you re-parse 60×/sec.

`.htmd` solves the problem every AI chat client hits: the moment the model needs to emit anything richer than prose (tables, choices, tools, diffs, fragments), you either dump it into a side panel ("canvas", "artifacts") or you re-parse the entire markdown string per frame. `.htmd` makes the bubble *be* the artefact — addressable, regeneratable, replayable, streamable region-by-region.

## Packages

| Package | Purpose |
|---|---|
| [`@htmd/parser`](./packages/parser) | Parse `.htmd` source into an AST. Markdown via remark, HTML via the browser's parser. |
| [`@htmd/elements`](./packages/elements) | First-party Lit web components — the base set of renderable elements (`<chat-message>`, `<data-table>`, `<choice-group>` + `<choice-item>`, `<code-block>`, `<image-card>`, `<file-preview>`, `<refine-prompt>`, `<htmd-fragment>`). |
| [`@htmd/wire`](./packages/wire) | Wire protocol — Zod-validated event types for the streaming format. Used by both producers (harnesses, model adapters) and consumers (chat clients, IDE panels). |

## Spec

Full specification: [`spec/htmd-spec.md`](./spec/htmd-spec.md).

## Status

Pre-alpha. APIs unstable. Framework-agnostic — works in any chat client, IDE panel, dashboard, or notebook where a producer can emit events and a consumer can render.

## Licence

MIT.
