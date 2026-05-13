import { z } from 'zod';

/**
 * Helm Pipe Protocol — the contract between a coding harness (or model
 * adapter) and a chat-client backend.
 *
 * Wire shape: `POST {harness_base_url}/turn` with `TurnRequest`; response is
 * an SSE stream of `PipeEvent`s, terminated by `done`.
 *
 * The backend translates each PipeEvent into one or more `.htmd` wire events
 * (see ./events.ts) and forwards to the consumer.
 */

export const TurnMessage = z.object({
  role: z.enum(['user', 'agent', 'system']),
  authorId: z.string(),
  bodyHtmd: z.string(),
  createdAt: z.string(),
});

export const HandConfig = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  systemPrompt: z.string().optional(),
  model: z.string().optional(),
  toolGrants: z.record(z.string(), z.unknown()).optional(),
});

export const HelmMeta = z.object({
  orgId: z.string(),
  channelId: z.string(),
  threadId: z.string().optional(),
  userId: z.string(),
  attachments: z
    .array(
      z.object({
        id: z.string(),
        kind: z.enum(['image', 'file', 'video', 'audio']),
        url: z.string().url(),
        name: z.string(),
        mime: z.string(),
      }),
    )
    .optional(),
});

export const TurnRequest = z.object({
  threadId: z.string(),
  messages: z.array(TurnMessage),
  hand: HandConfig,
  helm: HelmMeta,
});

export type TurnMessage = z.output<typeof TurnMessage>;
export type HandConfig = z.output<typeof HandConfig>;
export type HelmMeta = z.output<typeof HelmMeta>;
export type TurnRequest = z.output<typeof TurnRequest>;

/* ----------------------- pipe events (response stream) -------------------- */

export const PipeTextEvent = z.object({
  type: z.literal('text'),
  chunk: z.string(),
});

export const PipeRegionEvent = z.object({
  type: z.literal('region'),
  id: z.string(),
  tag: z.string(),
  parent: z.string().optional(),
  attrs: z.record(z.string(), z.string()).optional(),
});

export const PipeRegionDoneEvent = z.object({
  type: z.literal('region-done'),
  id: z.string(),
});

export const PipeToolCallEvent = z.object({
  type: z.literal('tool-call'),
  id: z.string(),
  name: z.string(),
  args: z.record(z.string(), z.unknown()),
});

export const PipeToolResultEvent = z.object({
  type: z.literal('tool-result'),
  callId: z.string(),
  status: z.enum(['ok', 'error']),
  summary: z.string(),
  payload: z.unknown().optional(),
});

export const PipeDiffEvent = z.object({
  type: z.literal('diff'),
  path: z.string(),
  before: z.string(),
  after: z.string(),
  language: z.string().optional(),
});

export const PipeTerminalEvent = z.object({
  type: z.literal('terminal'),
  stream: z.enum(['stdout', 'stderr']),
  chunk: z.string(),
});

export const PipeFragmentEvent = z.object({
  type: z.literal('fragment'),
  kind: z.string(),
  payload: z.unknown(),
});

export const PipeErrorEvent = z.object({
  type: z.literal('error'),
  message: z.string(),
  recoverable: z.boolean(),
});

export const PipeDoneEvent = z.object({
  type: z.literal('done'),
  stopReason: z.enum(['end_turn', 'tool_use', 'max_tokens', 'error']).optional(),
});

export const PipeEvent = z.discriminatedUnion('type', [
  PipeTextEvent,
  PipeRegionEvent,
  PipeRegionDoneEvent,
  PipeToolCallEvent,
  PipeToolResultEvent,
  PipeDiffEvent,
  PipeTerminalEvent,
  PipeFragmentEvent,
  PipeErrorEvent,
  PipeDoneEvent,
]);

export type PipeTextEvent = z.output<typeof PipeTextEvent>;
export type PipeRegionEvent = z.output<typeof PipeRegionEvent>;
export type PipeRegionDoneEvent = z.output<typeof PipeRegionDoneEvent>;
export type PipeToolCallEvent = z.output<typeof PipeToolCallEvent>;
export type PipeToolResultEvent = z.output<typeof PipeToolResultEvent>;
export type PipeDiffEvent = z.output<typeof PipeDiffEvent>;
export type PipeTerminalEvent = z.output<typeof PipeTerminalEvent>;
export type PipeFragmentEvent = z.output<typeof PipeFragmentEvent>;
export type PipeErrorEvent = z.output<typeof PipeErrorEvent>;
export type PipeDoneEvent = z.output<typeof PipeDoneEvent>;
export type PipeEvent = z.output<typeof PipeEvent>;

export function parsePipeEvent(raw: unknown): PipeEvent {
  return PipeEvent.parse(raw);
}
