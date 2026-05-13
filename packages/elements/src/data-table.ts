import { LitElement, css, html } from 'lit';
import { defineOnce } from './define-once.js';

interface TableRow {
  readonly [key: string]: unknown;
}

interface TableData {
  readonly columns: ReadonlyArray<string>;
  readonly rows: ReadonlyArray<TableRow>;
}

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
    .empty {
      padding: 24px;
      text-align: center;
      opacity: 0.6;
    }
  `;

  public static override properties = {
    src: { type: String },
    sort: { type: String },
    pageSize: { type: Number, attribute: 'page-size' },
    data: { type: Object, state: true },
    loading: { type: Boolean, state: true },
  };

  public src: string = '';
  public sort: string = '';
  public pageSize: number = 25;

  protected data: TableData | undefined = undefined;
  protected loading: boolean = false;

  public override connectedCallback(): void {
    super.connectedCallback();
    if (this.src.length > 0 && this.data === undefined) {
      void this.load();
    }
  }

  private async load(): Promise<void> {
    this.loading = true;
    try {
      const response = await fetch(this.src);
      if (!response.ok) {
        throw new Error(`fetch failed: ${response.status}`);
      }
      const json = (await response.json()) as TableData;
      this.data = json;
    } catch (error) {
      console.error('[htmd/data-table] load failed', error);
    } finally {
      this.loading = false;
    }
  }

  public override render(): unknown {
    if (this.loading) {
      return html`<div class="empty">Loading…</div>`;
    }
    if (this.data === undefined) {
      return html`<div class="empty">No data.</div>`;
    }
    return html`
      <table>
        <thead>
          <tr>
            ${this.data.columns.map((column) => html`<th>${column}</th>`)}
          </tr>
        </thead>
        <tbody>
          ${this.data.rows.map(
            (row) => html`
              <tr>
                ${this.data?.columns.map((column) => html`<td>${String(row[column] ?? '')}</td>`)}
              </tr>
            `,
          )}
        </tbody>
      </table>
    `;
  }
}

defineOnce('data-table', DataTable);
