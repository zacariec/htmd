import { z } from 'zod';

/**
 * .htmd wire protocol — region-addressed streaming events.
 *
 * A `.htmd` document is delivered as a sequence of these events over any
 * order-preserving transport (SSE, WebSocket, etc.). Each event carries a
 * monotonic `seq` per document for resumability.
 */

export const RegionId = z.string().regex(/^\$(\.[^.]+)*$/, {
  message: 'region id must be a dot-path starting with $',
});

export const DocOpenEvent = z.object({
  type: z.literal('doc-open'),
  seq: z.number().int().nonnegative(),
  id: z.string(),
  schemaVersion: z.string(),
});

export const RegionEvent = z.object({
  type: z.literal('region'),
  seq: z.number().int().nonnegative(),
  id: RegionId,
  tag: z.string(),
  parent: RegionId.optional(),
  attrs: z.record(z.string(), z.string()).optional(),
});

export const StreamEvent = z.object({
  type: z.literal('stream'),
  seq: z.number().int().nonnegative(),
  target: RegionId,
  chunk: z.string(),
});

export const RegionDoneEvent = z.object({
  type: z.literal('region-done'),
  seq: z.number().int().nonnegative(),
  id: RegionId,
});

export const RegionReplaceEvent = z.object({
  type: z.literal('region-replace'),
  seq: z.number().int().nonnegative(),
  id: RegionId,
  body: z.string(),
});

export const DocDoneEvent = z.object({
  type: z.literal('doc-done'),
  seq: z.number().int().nonnegative(),
  id: z.string(),
});

export const ErrorEvent = z.object({
  type: z.literal('error'),
  seq: z.number().int().nonnegative(),
  region: RegionId.optional(),
  message: z.string(),
  recoverable: z.boolean(),
});

export const WireEvent = z.discriminatedUnion('type', [
  DocOpenEvent,
  RegionEvent,
  StreamEvent,
  RegionDoneEvent,
  RegionReplaceEvent,
  DocDoneEvent,
  ErrorEvent,
]);

export type RegionId = z.output<typeof RegionId>;
export type DocOpenEvent = z.output<typeof DocOpenEvent>;
export type RegionEvent = z.output<typeof RegionEvent>;
export type StreamEvent = z.output<typeof StreamEvent>;
export type RegionDoneEvent = z.output<typeof RegionDoneEvent>;
export type RegionReplaceEvent = z.output<typeof RegionReplaceEvent>;
export type DocDoneEvent = z.output<typeof DocDoneEvent>;
export type ErrorEvent = z.output<typeof ErrorEvent>;
export type WireEvent = z.output<typeof WireEvent>;

export function parseWireEvent(raw: unknown): WireEvent {
  return WireEvent.parse(raw);
}

export function safeParseWireEvent(raw: unknown): z.SafeParseReturnType<unknown, WireEvent> {
  return WireEvent.safeParse(raw);
}
