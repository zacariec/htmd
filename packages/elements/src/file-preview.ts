import { LitElement, css, html } from 'lit';
import { defineOnce } from './define-once.js';

export class FilePreview extends LitElement {
  public static override styles = css`
    :host {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 14px;
      border: 1px solid var(--htmd-border, #27272a);
      border-radius: 8px;
      background: var(--htmd-file-bg, transparent);
    }
    .icon {
      width: 32px;
      height: 32px;
      border-radius: 4px;
      background: var(--htmd-border, #27272a);
      display: grid;
      place-items: center;
      font-size: 11px;
      text-transform: uppercase;
    }
    .meta {
      display: flex;
      flex-direction: column;
      gap: 2px;
      flex: 1;
      min-width: 0;
    }
    .name {
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .size {
      font-size: 12px;
      opacity: 0.7;
    }
    a {
      color: var(--htmd-accent, #6366f1);
      text-decoration: none;
      font-size: 13px;
    }
  `;

  public static override properties = {
    name: { type: String, reflect: true },
    mime: { type: String, reflect: true },
    sizeBytes: { type: Number, attribute: 'size-bytes' },
    href: { type: String, reflect: true },
  };

  public name: string = '';
  public mime: string = '';
  public sizeBytes: number = 0;
  public href: string = '';

  public override render(): unknown {
    return html`
      <div class="icon">${this.iconLabel()}</div>
      <div class="meta">
        <span class="name">${this.name}</span>
        <span class="size">${this.formatSize(this.sizeBytes)} · ${this.mime}</span>
      </div>
      ${this.href.length > 0 ? html`<a href=${this.href} download=${this.name}>download</a>` : null}
    `;
  }

  private iconLabel(): string {
    if (this.mime.startsWith('image/')) {
      return 'img';
    }
    if (this.mime === 'application/pdf') {
      return 'pdf';
    }
    if (this.mime.startsWith('text/') || this.mime === 'application/json') {
      return 'txt';
    }
    return 'file';
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
}

defineOnce('file-preview', FilePreview);
