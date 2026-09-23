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

## Transport

`EventSource` cannot POST a prompt or send auth headers, so read the events from a `fetch` response instead. On the server, `toEventStream` encodes events as an HTTP body:

```ts
import { WIRE_EVENT_STREAM_HEADERS, streamText, toEventStream } from '@htmdjs/wire';

export async function POST(request: Request): Promise<Response> {
  const tokens = model.stream(await request.json()); // AsyncIterable<string>
  return new Response(toEventStream(streamText(tokens)), { headers: WIRE_EVENT_STREAM_HEADERS });
}
```

- It writes SSE `data:` frames by default, or one JSON event per line with `{ format: 'jsonl' }`.
- It pulls one event per read, so a slow client slows generation instead of buffering it.
- If the client disconnects, the stream is cancelled, which closes the event source; `streamText` then closes the model stream.
- If the event source throws, the stream errors.
- `WIRE_EVENT_STREAM_HEADERS` sets `content-type: text/event-stream; charset=utf-8` and `cache-control: no-cache`.

On the client, `readWireEvents` takes a `Response`, a promise of one, or a byte stream, and yields validated events:

```ts
import { readWireEvents } from '@htmdjs/wire';

const controller = new AbortController();
const response = fetch('/api/chat', { method: 'POST', body: JSON.stringify({ prompt }), signal: controller.signal });
for await (const event of readWireEvents(response, { signal: controller.signal })) {
  renderer.apply(event);
}
```

With React, memoize the generator so a re-render doesn't start a new request. When the component unmounts, `useHtmdStream` stops iterating, which cancels the response body:

```tsx
const events = useMemo(() => readWireEvents(fetch('/api/chat', { method: 'POST', body })), [body]);
const { ref, status } = useHtmdStream(events);
return <div ref={ref} aria-busy={status === 'streaming'} />;
```

- A response that is not ok throws `HTTP <status> <statusText>`, such as `HTTP 502 Bad Gateway`.
- `format` defaults to `auto`. A response with a `text/event-stream` content type is read as SSE; any other response is read as JSONL. For a bare byte stream, a first non-blank line starting with `data:`, `event:`, `id:`, `retry:`, or `:` means SSE; anything else means JSONL. Pass `format: 'sse'` or `format: 'jsonl'` to skip detection.
- SSE follows the HTML event stream rules. Lines can end with `\n`, `\r\n`, or `\r`. Comments such as heartbeats and `id:` and `retry:` fields are ignored. Several `data:` lines join with `\n`. Events named anything other than `message` are skipped, so one stream can carry other event types. A message still missing its closing blank line when the stream ends is discarded.
- JSONL reads each non-blank line as one event; a final line needs no trailing newline.
- Each message is JSON-parsed and validated. A malformed or invalid one throws an error naming its 1-based message number (counting only wire messages, not skipped events or comments).
- Stopping iteration early, aborting `signal`, or an error cancels the response body. Aborting throws the signal's reason.

Part of the `.htmd` project — <https://github.com/zacariec/htmd#readme>.
