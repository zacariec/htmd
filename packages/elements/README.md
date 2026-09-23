# `@htmdjs/elements`

Lit web components implementing the nine base HTMD contracts: `<chat-message>`, `<data-table>`, `<choice-group>` + `<choice-item>`, `<code-block>`, `<image-card>`, `<file-preview>`, `<refine-prompt>`, `<htmd-fragment>`. Their attributes, children, partial behavior, state, and intents are defined in `@htmdjs/contracts`.

```ts
import { ComponentEvents } from '@htmdjs/contracts';
import type { ChoiceDetail } from '@htmdjs/contracts';
import { registerHtmdElements } from '@htmdjs/elements';

registerHtmdElements();
const stage = document.querySelector('#stage');
stage?.addEventListener(ComponentEvents.Choice, (event) => {
  const { name, value, region } = (event as CustomEvent<ChoiceDetail>).detail;
  console.info(name, value, region);
});
```

Node/SSR-safe: importing never touches `customElements`; `registerHtmdElements()` guards it. Registration makes the tags known to the browser; the renderer still instantiates only components in the host's catalog.

## Host capabilities

Components ask for their host with `requestHtmdHost(this)` when an effect is about to happen, and pass every URL through `authorizeComponentUrl` for its purpose. Under a renderer the host is the one it was given; standalone elements fall back to `defaultHost`.

- `<data-table>` loads `src` only when the host authorizes `data`, through `host.loadData` when present (a complete `TablePayload` or progressive `TableBatch` batches) or as fetched JSON otherwise. With the default host, data tables are **blocked**. Loads are cancelled when `src` changes or the element is removed; an error after rows arrive leaves the table interrupted with its rows kept. At most `MAX_TABLE_ROWS` rows render.
- `<image-card>` loads `src` only when authorized for `image`; otherwise it shows the alt text.
- `<file-preview>` exposes its download link only when `href` is authorized for `download`.
- `<htmd-fragment>` renders nested components only when the host catalog resolves them; native `img` sources are authorized as `image` and `a` links as `link`.

## Intents

`choice` and `refine` events use `ComponentEvents`, `ChoiceDetail`, and `RefineDetail` from `@htmdjs/contracts`. Both bubble, are composed, and carry `region`, the nearest enclosing `data-htmd-region` (omitted outside regions). After handling a `refine`, call `element.reset(clearInput?)` to end the submission.

This package no longer exports `HtmdElementEvents`, `ChoiceDetail`, `ChoiceSelectDetail`, or `RefineDetail`; import intents from `@htmdjs/contracts`. The static `DataTable.urlPolicy` hook is removed; authorize URLs with a host.

Register only trusted component implementations. A hyphenated tag name is not a sandbox for arbitrary registered code.

Part of the `.htmd` project — <https://github.com/zacariec/htmd#readme>.
