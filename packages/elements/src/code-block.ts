import { LitElement, css, html } from 'lit';
import { defineOnce } from './define-once.js';

export class CodeBlock extends LitElement {
  public static override styles = css`
    :host {
      display: block;
      border-radius: 8px;
      background: var(--htmd-code-bg, #0a0a0a);
      color: var(--htmd-code-fg, #e5e5e5);
      font-family: var(--htmd-code-font, ui-monospace, SFMono-Regular, Menlo, monospace);
      position: relative;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 12px;
      font-size: 12px;
      opacity: 0.7;
      border-bottom: 1px solid var(--htmd-border, #27272a);
    }
    pre {
      margin: 0;
      padding: 12px;
      overflow: auto;
      font-size: 13px;
      line-height: 1.5;
    }
    button {
      background: transparent;
      border: 1px solid var(--htmd-border, #27272a);
      border-radius: 4px;
      color: inherit;
      cursor: pointer;
      font-size: 11px;
      padding: 2px 8px;
    }
  `;

  public static override properties = {
    language: { type: String, reflect: true },
    showCopy: { type: Boolean, attribute: 'show-copy' },
  };

  public language: string = '';
  public showCopy: boolean = true;

  private handleCopy = async (): Promise<void> => {
    const text = this.textContent ?? '';
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      console.error('[htmd/code-block] copy failed', error);
    }
  };

  public override render(): unknown {
    return html`
      <div class="header">
        <span>${this.language || 'code'}</span>
        ${this.showCopy ? html`<button @click=${this.handleCopy}>copy</button>` : null}
      </div>
      <pre><code><slot></slot></code></pre>
    `;
  }
}

defineOnce('code-block', CodeBlock);
