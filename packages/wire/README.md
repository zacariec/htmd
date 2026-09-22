# `@htmdjs/wire`

Zod-validated wire event types for the `.htmd` streaming protocol. Seven event kinds, discriminated union, JSON-line parse helper.

```ts
import { parseWireEventJson, WireEvent } from '@htmdjs/wire';

for (const line of jsonl.split('\n')) {
  const event = parseWireEventJson(line);
  applyEvent(event);
}
```

Schemas validate event shapes. The renderer enforces version `0.1`, document/region lifecycle, and accepted-sequence replay. Use an ordered transport and one global sequence per document when combining producers.

Part of the `.htmd` project — <https://github.com/zacariec/htmd#readme>.
