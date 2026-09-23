# `@htmdjs/parser`

Dependency-free parser for HTMD: Markdown prose and custom-element structure, with diagnostics and explicit partial-source handling.

```ts
import { Parser } from '@htmdjs/parser';

const parser = Parser.getInstance();
const partial = parser.parse('Hello <file-pre', { streaming: true });
// partial.pending === true; the incomplete tag is withheld from renderable nodes.
const final = parser.parse('Hello <file-pre');
// The unfinished source remains literal Markdown with an incomplete-tag diagnostic.
```

`ParseResult` contains `document`, `diagnostics`, and `pending`. `document.source` always retains the original input. Streaming mode defers missing-close warnings for open elements and preserves their available children. Known unfinished tag syntax, fences, and inline backtick spans set `pending`; this is not a detector for every incomplete Markdown construct. Final parsing always clears `pending`.

`ElementBlock.complete` is `true` for self-closing elements and elements whose closing tag was found, and `false` while the closing tag has not arrived. Renderers use it to defer components whose contracts require complete source.

`ParseOptions`:

- `streaming`: buffer incomplete custom tags and keep open elements open until finalization.
- `rawTextTags`: tags whose content is a raw text payload, never parsed as custom elements (default `DEFAULT_RAW_TEXT_TAGS`: `htmd-fragment` and `code-block`). Pass `catalog.rawTextTags()` from `@htmdjs/contracts` to match a host catalog.
- `maxDepth`: custom-element nesting limit (default 64). Opening tags nested deeper stay literal Markdown with a `nesting-too-deep` error diagnostic.

The parser keeps Markdown verbatim; it does not interpret or repair it. Provisional rendering of an unfinished Markdown frontier happens in `@htmdjs/renderer`. Code fences and code spans do not create custom elements. Final rendering must use a Markdown renderer with raw HTML disabled.

Attribute values decode the five named XML-style entities and valid decimal/hex Unicode references exactly once. Unknown/invalid references stay literal. This backfills Bench's round-trip fix; consumers must not decode attributes again. Forbidden-scheme diagnostics inspect decoded values but are not a replacement for component URL policies.

Part of [HTMD](https://github.com/zacariec/htmd). Install with `npm install @htmdjs/parser@alpha`.
