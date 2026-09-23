# `@htmdjs/wire`

The `.htmd` streaming protocol: Zod-validated event types (seven event kinds, one discriminated union), JSON parsing for consumers, and helpers for producers.

## Produce events

`streamText` turns streamed text, such as model output, into a complete document:

```ts
import { streamText } from '@htmdjs/wire';

// tokens: any AsyncIterable<string> or Iterable<string>.
for await (const event of streamText(tokens, { region: '$.answer' })) {
  response.write(`data: ${JSON.stringify(event)}\n\n`); // or renderer.apply(event)
}
```

- It emits `doc-open`, `region`, one `stream` per non-empty chunk, `region-done`, and `doc-done`.
- Options: `docId` (default `"htmd"`), `region` (default `"$.body"`), and the region's `tag` (default `div`), `parent`, and `attrs`.
- If the text source throws, it emits a fatal `error` event for the region and rethrows the original error.
- If the consumer stops iterating, the text source is closed too, so upstream generation stops.
- An invalid region id rejects before any event is produced.

`WireWriter` builds any document, including ones with several regions. It numbers every event, so producers never set `seq` by hand, and validates region ids:

```ts
import { WireWriter } from '@htmdjs/wire';

const doc = new WireWriter('answer');
send(doc.open());
send(doc.region('$.summary'));
send(doc.region('$.details', { tag: 'section' }));
send(doc.stream('$.details', 'Loading the breakdown…'));
send(doc.stream('$.summary', 'Revenue grew **12%**.'));
send(doc.replace('$.details', 'Revised breakdown.'));
send(doc.done('$.summary'));
send(doc.close());
```

Methods: `open()`, `region(id, { tag?, parent?, attrs? })`, `stream(target, chunk)`, `done(id)`, `replace(id, body)`, `error(message, { recoverable?, region? })`, and `close()`. Errors are fatal unless `recoverable: true`. `close()` or a fatal `error()` ends the document; later calls throw. Start a new writer for each document. A replaying producer can start a new writer from sequence 0: consumers skip events they already applied.

## Consume events

```ts
import { parseWireEventJson } from '@htmdjs/wire';

for (const line of jsonl.split('\n')) {
  const event = parseWireEventJson(line);
  applyEvent(event);
}
```

Schemas validate event shapes. `SCHEMA_VERSION` (`"0.1"`) is the version produced and accepted. The renderer enforces the version, document and region lifecycle, and accepted-sequence replay. Use an ordered transport and one global sequence per document when combining producers.

Part of the `.htmd` project — <https://github.com/zacariec/htmd#readme>.
