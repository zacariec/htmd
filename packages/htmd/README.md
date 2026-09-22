# `@zacariec/htmd`

Streaming-first Markdown, interactive custom elements, and a region-addressed document-update protocol for AI output.

```sh
npm install @zacariec/htmd@alpha
```

```ts
import { Parser, RegionTreeRenderer, renderHtmdSource, registerHtmdElements } from '@zacariec/htmd';

registerHtmdElements();
```

The browser export condition registers the base elements automatically; explicit registration is idempotent. Node/SSR imports are safe and do not register elements. DOM rendering requires a browser.

This meta package re-exports the parser, wire event types, components, and renderer. React is optional: install `@zacariec/htmd-react@alpha` separately.

Streaming appends preserve existing component interaction state; incomplete custom syntax is buffered; completion and targeted replacement have explicit lifecycle rules. Markdown remains provisional until finalized. Rendering reuses unchanged blocks but is not a fully incremental Markdown parser.

Individual packages: `@zacariec/htmd-parser`, `@zacariec/htmd-wire`, `@zacariec/htmd-elements`, `@zacariec/htmd-renderer`, and `@zacariec/htmd-react`.

The unrelated unscoped npm package `htmd` is not this project. Full specification and examples: <https://github.com/zacariec/htmd>.
