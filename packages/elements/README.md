# `@zacariec/htmd-elements`

Lit web components — the base element set for `.htmd`. Nine components: `<chat-message>`, `<data-table>`, `<choice-group>` + `<choice-item>`, `<code-block>`, `<image-card>`, `<file-preview>`, `<refine-prompt>`, `<htmd-fragment>`.

```ts
import { registerHtmdElements } from '@zacariec/htmd-elements';
registerHtmdElements();
```

Node/SSR-safe: importing never touches `customElements`; `registerHtmdElements()` guards it.

Register only trusted component implementations. Built-in components apply their own URL and payload policies; the renderer's custom-element syntax is not a sandbox for arbitrary registered code.

Part of the `.htmd` project — <https://github.com/zacariec/htmd#readme>.
