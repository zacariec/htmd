import { z } from 'zod';

/**
 * Structured payloads components accept from untrusted producers or hosts.
 * Each is validated before any of it renders.
 */

/** Complete `<data-table>` data. */
export const TablePayload = z.object({
  columns: z.array(z.string()),
  rows: z.array(z.record(z.string(), z.unknown())),
});
export type TablePayload = z.output<typeof TablePayload>;

/**
 * One progressive `<data-table>` batch. The first batch must carry `columns`;
 * later batches append complete, validated rows.
 */
export const TableBatch = z.object({
  columns: z.array(z.string()).optional(),
  rows: z.array(z.record(z.string(), z.unknown())),
});
export type TableBatch = z.output<typeof TableBatch>;

/** Rows beyond this bound are not rendered; the table reports truncation. */
export const MAX_TABLE_ROWS = 5000;

export interface FragmentNode {
  readonly tag: string;
  readonly class?: string | undefined;
  readonly text?: string | undefined;
  readonly for?: string | undefined;
  readonly attrs?: Readonly<Record<string, string>> | undefined;
  readonly children?: readonly FragmentNode[] | undefined;
}

/** `<htmd-fragment>` payload: structured intent, parsed and interpreted, never evaluated. */
export const FragmentNode: z.ZodType<FragmentNode> = z.object({
  tag: z.string(),
  class: z.string().optional(),
  text: z.string().optional(),
  for: z.string().optional(),
  attrs: z.record(z.string(), z.string()).optional(),
  get children() {
    return z.array(FragmentNode).optional();
  },
});

export const FragmentState = z.record(z.string(), z.unknown());
export type FragmentState = z.output<typeof FragmentState>;
