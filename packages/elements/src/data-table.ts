import {
  MAX_TABLE_ROWS,
  TableBatch,
  TablePayload,
  authorizeComponentUrl,
  requestHtmdHost,
} from '@htmdjs/contracts';
import type { HtmdHost } from '@htmdjs/contracts';
import { LitElement, css, html, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { createRef, ref } from 'lit/directives/ref.js';

import { HtmdElementsLogger } from './internal/logger.js';

/**
 * `<data-table>` — tabular data loaded through the host.
 *
 * `src` is producer-controlled, so it is never permission to load: the host
 * must authorize it for "data" (the default host never does). The host's
 * `loadData` loads it when present; otherwise it is fetched as JSON.
 *
 * A loader may return a complete `TablePayload` or an async iterable of
 * `TableBatch`es whose rows render as they arrive. Every payload is validated
 * before any of it renders, and at most `MAX_TABLE_ROWS` rows render.
 *
 * Each load belongs to the current `src`: changing `src` or disconnecting
 * aborts it and late results are discarded; reconnecting restarts an aborted
 * load.
 */

export type DataTableState =
  | 'blocked'
  | 'loading'
  | 'partial'
  | 'loaded'
  | 'empty'
  | 'interrupted'
  | 'failed';

type TableRow = TablePayload['rows'][number];

const BLOCKED_TEXT = 'This data source is not allowed here.';
const INTERRUPTED_TEXT = 'Loading stopped early; showing the rows received.';
const TRUNCATED_TEXT = `Showing the first ${MAX_TABLE_ROWS} rows.`;

export class DataTable extends LitElement {
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
    .status {
      margin: 0;
      padding: 12px 24px;
      text-align: center;
      opacity: 0.7;
    }
    .status.blocked,
    .status.failed,
    .status.interrupted {
      color: var(--htmd-error, #dc2626);
      opacity: 1;
    }
  `;

  public static override properties = {
    src: { type: String, reflect: true },
    loadingText: { type: String, attribute: 'loading-text' },
    emptyText: { type: String, attribute: 'empty-text' },
    errorText: { type: String, attribute: 'error-text' },
    state: { state: true },
  };

  public src: string = '';
  public loadingText: string = 'Loading…';
  public emptyText: string = 'No data.';
  public errorText: string = 'Failed to load data.';

  private state: DataTableState = 'loading';
  private columns: readonly string[] = [];
  /** Rows of the current load; replaced (not cleared) when a new load starts. */
  private rows: TableRow[] = [];
  private truncated: boolean = false;
  /** `src` the current rows and state belong to; undefined when none loaded. */
  private loadedSrc: string | undefined = undefined;
  /** Present while a load is in flight. */
  private controller: AbortController | undefined = undefined;

  /**
   * Row cells are appended to the tbody directly, so each batch costs only
   * its own rows instead of re-rendering every row received so far.
   */
  private readonly body = createRef<HTMLTableSectionElement>();
  private renderedBody: HTMLTableSectionElement | undefined = undefined;
  private renderedRows: readonly TableRow[] | undefined = undefined;
  private renderedCount: number = 0;

  /** Where the table is in loading its current `src`. */
  public get loadState(): DataTableState {
    return this.state;
  }

  public override connectedCallback(): void {
    super.connectedCallback();
    if (this.hasUpdated) {
      this.syncLoad();
    }
  }

  public override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.controller !== undefined) {
      this.controller.abort();
      this.controller = undefined;
      this.loadedSrc = undefined;
    }
  }

  protected override willUpdate(): void {
    this.syncLoad();
  }

  /** Starts a load when connected and `src` differs from the loaded source. */
  private syncLoad(): void {
    if (!this.isConnected || this.src === this.loadedSrc) {
      return;
    }
    this.controller?.abort();
    this.controller = undefined;
    this.loadedSrc = this.src;
    this.columns = [];
    this.rows = [];
    this.truncated = false;

    const host = requestHtmdHost(this);
    const url = authorizeComponentUrl(this, this.src, 'data', host);
    if (url === undefined) {
      HtmdElementsLogger.getInstance().warn(
        `data-table src "${this.src}" is not authorized by the host; not loading`,
      );
      this.state = 'blocked';
      return;
    }
    const controller = new AbortController();
    this.controller = controller;
    this.state = 'loading';
    void this.load(url, host, controller);
  }

  private async load(url: URL, host: HtmdHost, controller: AbortController): Promise<void> {
    const { signal } = controller;
    try {
      const source =
        host.loadData === undefined
          ? fetchJson(url, signal)
          : host.loadData({ url, component: this.localName, element: this, signal });
      if (isAsyncIterable(source)) {
        let first = true;
        for await (const batch of source) {
          if (signal.aborted) {
            return;
          }
          this.appendBatch(batch, first);
          first = false;
          this.state = 'partial';
          if (this.truncated) {
            break;
          }
        }
      } else {
        const payload = TablePayload.safeParse(await source);
        if (signal.aborted) {
          return;
        }
        if (!payload.success) {
          throw new Error('data-table payload is not { columns, rows }');
        }
        this.columns = payload.data.columns;
        this.appendRows(payload.data.rows);
      }
      if (signal.aborted) {
        return;
      }
      this.state = this.rows.length === 0 ? 'empty' : 'loaded';
    } catch (error) {
      if (signal.aborted) {
        return;
      }
      HtmdElementsLogger.getInstance().error('data-table load failed', error);
      this.state = this.rows.length === 0 ? 'failed' : 'interrupted';
    } finally {
      if (this.controller === controller) {
        this.controller = undefined;
      }
    }
  }

  /** Validates one progressive batch; the first must carry `columns`. */
  private appendBatch(value: unknown, first: boolean): void {
    const batch = TableBatch.safeParse(value);
    if (!batch.success) {
      throw new Error('data-table batch is not { columns?, rows }');
    }
    if (first) {
      if (batch.data.columns === undefined) {
        throw new Error('data-table first batch must carry columns');
      }
      this.columns = batch.data.columns;
    }
    this.appendRows(batch.data.rows);
  }

  private appendRows(rows: readonly TableRow[]): void {
    const room = MAX_TABLE_ROWS - this.rows.length;
    if (rows.length > room) {
      this.truncated = true;
    }
    this.rows.push(...rows.slice(0, room));
    this.requestUpdate();
  }

  private statusText(): string {
    switch (this.state) {
      case 'blocked':
        return BLOCKED_TEXT;
      case 'loading':
      case 'partial':
        return this.loadingText;
      case 'empty':
        return this.emptyText;
      case 'interrupted':
        return INTERRUPTED_TEXT;
      case 'failed':
        return this.errorText;
      case 'loaded':
        return this.truncated ? TRUNCATED_TEXT : '';
    }
  }

  public override render(): TemplateResult {
    const busy = this.state === 'loading' || this.state === 'partial';
    return html`
      <div class="rows" aria-busy=${busy ? 'true' : 'false'}>
        ${this.rows.length > 0 || this.state === 'partial' ? this.renderTable() : nothing}
      </div>
      <p class="status ${this.state}" role="status" aria-live="polite">${this.statusText()}</p>
    `;
  }

  private renderTable(): TemplateResult {
    return html`
      <table>
        <thead>
          <tr>
            ${this.columns.map((column) => html`<th scope="col">${column}</th>`)}
          </tr>
        </thead>
        <tbody ${ref(this.body)}></tbody>
      </table>
    `;
  }

  /** Appends rows not yet in the tbody; a new tbody or a new load starts over. */
  protected override updated(): void {
    const body = this.body.value;
    if (body === undefined) {
      return;
    }
    if (body !== this.renderedBody || this.rows !== this.renderedRows) {
      body.replaceChildren();
      this.renderedBody = body;
      this.renderedRows = this.rows;
      this.renderedCount = 0;
    }
    const document = this.ownerDocument;
    const fragment = document.createDocumentFragment();
    for (const row of this.rows.slice(this.renderedCount)) {
      const tr = document.createElement('tr');
      for (const column of this.columns) {
        const td = document.createElement('td');
        td.textContent = String(row[column] ?? '');
        tr.append(td);
      }
      fragment.append(tr);
    }
    body.append(fragment);
    this.renderedCount = this.rows.length;
  }
}

async function fetchJson(url: URL, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url.href, {
    signal,
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`data request failed with status ${response.status}`);
  }
  return (await response.json()) as unknown;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return typeof value === 'object' && value !== null && Symbol.asyncIterator in value;
}
