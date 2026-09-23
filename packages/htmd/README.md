# `@htmdjs/core`

A streaming-first document protocol and runtime for Markdown and interactive components. HTMD defines how incomplete content renders, how addressed sections change, and how interaction survives updates.

```sh
npm install @htmdjs/core@alpha
```

```ts
import { RegionTreeRenderer, baseCatalog, createHost, registerHtmdElements } from '@htmdjs/core';

registerHtmdElements();
const host = createHost({ components: baseCatalog });
const container = document.querySelector('#answer');
if (!container) throw new Error('Missing answer container');
const renderer = new RegionTreeRenderer(container, { host });
```

The browser export condition registers the base elements automatically; explicit registration is idempotent. Node/SSR imports are safe and do not register elements. DOM rendering requires a browser.

This meta package re-exports the full public API of `@htmdjs/contracts` (component contracts, catalogs, hosts, intents, payload schemas, validation) together with the parser, wire event types, components, and renderer (including `RenderLimits`, `DEFAULT_RENDER_LIMITS`, `MaterializeOptions`, and `RenderResult`). React is optional: install `@htmdjs/react@alpha` separately.

The host decides which components a document may use, which URLs they may load per purpose, and how component data is loaded; data URLs are never authorized by default. Streaming appends preserve existing component interaction state; incomplete custom syntax is buffered; `complete`-policy components show a `data-htmd-deferred` placeholder until their closing tag arrives; the unfinished end of streaming Markdown renders provisionally, completing unambiguous syntax and withholding ambiguous syntax, so readers never see markers that later vanish and half-written links are never clickable. Finalization uses ordinary CommonMark + GFM. Completion and targeted replacement have explicit lifecycle rules. Each chunk reparses the affected region: rendering reuses unchanged blocks but is not a fully incremental Markdown parser.

Individual packages: `@htmdjs/contracts`, `@htmdjs/parser`, `@htmdjs/wire`, `@htmdjs/elements`, `@htmdjs/renderer`, and `@htmdjs/react`.

The unrelated unscoped npm package `htmd` is not this project. Full specification and examples: <https://github.com/zacariec/htmd>.
