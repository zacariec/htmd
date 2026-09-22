import { describe, expect, it } from 'vitest';
import { RegionId, parseWireEvent, parseWireEventJson, safeParseWireEvent } from '../src/events.js';

describe('RegionId', () => {
  it('accepts the document root', () => {
    expect(RegionId.safeParse('$').success).toBe(true);
  });

  it('accepts dot-path segments', () => {
    expect(RegionId.safeParse('$.channel.msg.abc123.body').success).toBe(true);
    expect(RegionId.safeParse('$.a.b-c.d_e').success).toBe(true);
  });

  it('rejects paths without the $ root', () => {
    expect(RegionId.safeParse('channel.msg').success).toBe(false);
  });

  it('rejects segments with whitespace or braces', () => {
    expect(RegionId.safeParse('$.a b').success).toBe(false);
    expect(RegionId.safeParse('$.{msg}').success).toBe(false);
    expect(RegionId.safeParse('$..double').success).toBe(false);
  });
});

describe('WireEvent parsing', () => {
  const roundTrip = [
    { type: 'doc-open', seq: 0, id: 'doc-1', schemaVersion: '0.1' },
    { type: 'region', seq: 1, id: '$.msg', tag: 'chat-message', attrs: { author: 'agent' } },
    { type: 'region', seq: 2, id: '$.msg.body', tag: 'div', parent: '$.msg' },
    { type: 'stream', seq: 3, target: '$.msg.body', chunk: 'Hello **world**' },
    { type: 'region-done', seq: 4, id: '$.msg.body' },
    { type: 'region-replace', seq: 5, id: '$.msg.body', body: 'Revised.' },
    { type: 'error', seq: 6, region: '$.msg', message: 'boom', recoverable: true },
    { type: 'doc-done', seq: 7, id: 'doc-1' },
  ];

  it('round-trips every event type through JSON', () => {
    for (const event of roundTrip) {
      const parsed = parseWireEventJson(JSON.stringify(event));
      expect(parsed).toEqual(event);
    }
  });

  it('narrows the discriminated union', () => {
    const parsed = parseWireEvent({ type: 'stream', seq: 1, target: '$.a', chunk: 'x' });
    expect(parsed.type).toBe('stream');
    if (parsed.type === 'stream') {
      expect(parsed.chunk).toBe('x');
    }
  });

  it('rejects unknown event types', () => {
    expect(safeParseWireEvent({ type: 'nope', seq: 0 }).success).toBe(false);
  });

  it('rejects negative or fractional seq', () => {
    expect(safeParseWireEvent({ type: 'doc-done', seq: -1, id: 'x' }).success).toBe(false);
    expect(safeParseWireEvent({ type: 'doc-done', seq: 1.5, id: 'x' }).success).toBe(false);
  });

  it('rejects a stream event without a chunk', () => {
    expect(safeParseWireEvent({ type: 'stream', seq: 1, target: '$.a' }).success).toBe(false);
  });

  it('surfaces malformed JSON as a throw from parseWireEventJson', () => {
    expect(() => parseWireEventJson('{not json')).toThrow();
  });
});
