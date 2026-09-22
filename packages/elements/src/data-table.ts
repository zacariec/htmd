import { LitElement, css, html } from 'lit';
import type { PropertyValues, TemplateResult } from 'lit';
import { z } from 'zod';

import { HtmdElementsLogger } from './internal/logger.js';

/**
 * `<data-table>` — tabular data fetched from `src`.
 *
 * Fetch policy: same-origin only by default. The document author (usually a
 * model) controls `src`, so cross-origin fetches are opt-in by the consumer
 * via the static `DataTable.urlPolicy` hook — never by the document.
 *
 * The fetched payload is untrusted and validated with Zod before render.
 */

const TableDataSchema = z.object({
  columns: z.array(z.string()),
  rows: z.array(z.record(z.string(), z.unknown())),
});

type TableData = z.output<typeof TableDataSchema>;

type LoadState = 'idle' | 'loading' | 'loaded' | 'error';

export class DataTable extends LitElement {
  /**
   * Consumer-controlled fetch policy. Receives the resolved URL; returns
   * whether the fetch may proceed. Defaults to same-origin only.
   */
  public static urlPolicy: (url: URL) => boolean = (url) =>
    typeof location !== 'undefined' && url.origin === location.origin;

  public static override styles = css`
    :host {
      display: block;
      overflow: auto;
      border: 1px solid var(--htmd-border, #27272a);
      border-radius: 8px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
    }
    th,
    td {
      padding: 8px 12px;
      text-align: left;
      border-bottom: 1px solid var(--htmd-border, #27272a);
    }
    th {
      font-weight: 600;
      background: var(--htmd-th-bg, rgba(255, 255, 255, 0.03));
    }
    .empty {
      padding: 24px;
      text-align: center;
      opacity: 0.6;
    }
    .error {
      padding: 24px;
      text-align: center;
      color: var(--htmd-error, #dc2626);
    }
  `;

  public static override properties = {
    src: { type: String, reflect: true },
    loadingText: { type: String, attribute: 'loading-text' },
    emptyText: { type: String, attribute: 'empty-text' },
    errorText: { type: String, attribute: 'error-text' },
    data: { state: true },
    loadState: { state: true },
  };

  public src: string = '';
  public loadingText: string = 'Loading…';
  public emptyText: string = 'No data.';
  public errorText: string = 'Failed to load data.';

  protected data: TableData | undefined = undefined;
  protected loadState: LoadState = 'idle';

  private loadedSrc: string | undefined = undefined;

  protected override updated(changed: PropertyValues): void {
    super.updated(changed);
    if (this.src.length > 0 && this.src !== this.loadedSrc) {
      void this.load();
    }
  }

  private async load(): Promise<void> {
    const requestedSrc = this.src;
    this.loadedSrc = requestedSrc;

    const resolved = this.resolveUrl(requestedSrc);
    if (resolved === undefined || !DataTable.urlPolicy(resolved)) {
      HtmdElementsLogger.getInstance().warn(
        `data-table src blocked by fetch policy: "${requestedSrc}"`,
      );
      this.loadState = 'error';
      return;
    }

    this.loadState = 'loading';
    try {
      const response = await fetch(resolved.toString());
      if (!response.ok) {
        throw new Error(`fetch failed with status ${response.status}`);
      }
      const payload = TableDataSchema.safeParse((await response.json()) as unknown);
      if (!payload.success) {
        throw new Error('payload does not match { columns, rows }');
      }
      if (this.src !== requestedSrc) {
        return;
      }
      this.data = payload.data;
      this.loadState = 'loaded';
    } catch (error) {
      HtmdElementsLogger.getInstance().error('data-table load failed', error);
      if (this.src === requestedSrc) {
        this.data = undefined;
        this.loadState = 'error';
      }
    }
  }

  private resolveUrl(src: string): URL | undefined {
    try {
      const base = typeof document === 'undefined' ? undefined : document.baseURI;
      return new URL(src, base);
    } catch {
      return undefined;
    }
  }

  public override render(): TemplateResult {
    if (this.loadState === 'loading') {
      return html`<div class="empty">${this.loadingText}</div>`;
    }
    if (this.loadState === 'error') {
      return html`<div class="error">${this.errorText}</div>`;
    }
    if (this.data === undefined || this.data.columns.length === 0) {
      return html`<div class="empty">${this.emptyText}</div>`;
    }
    const { columns, rows } = this.data;
    return html`
      <table>
        <thead>
          <tr>
            ${columns.map((column) => html`<th>${column}</th>`)}
          </tr>
        </thead>
        <tbody>
          ${rows.map(
            (row) => html`
              <tr>
                ${columns.map((column) => html`<td>${String(row[column] ?? '')}</td>`)}
              </tr>
            `,
          )}
        </tbody>
      </table>
    `;
  }
}
