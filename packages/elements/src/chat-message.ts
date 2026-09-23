import { LitElement, css, html, nothing } from 'lit';
import type { PropertyValues, TemplateResult } from 'lit';

export type ChatMessageAuthor = 'user' | 'agent' | 'system';
export type ChatMessageStatus = 'streaming' | 'complete' | 'failed';

export class ChatMessage extends LitElement {
  public static override styles = css`
    :host {
      display: block;
      padding: 12px 16px;
      border-radius: 8px;
      background: var(--htmd-chat-message-bg, transparent);
    }
    .meta {
      font-size: 12px;
      opacity: 0.7;
      margin-bottom: 4px;
    }
    :host([status='streaming']) .meta::after {
      content: ' · streaming…';
    }
    :host([status='failed']) .meta::after {
      content: ' · failed';
      color: var(--htmd-error, #dc2626);
    }
  `;

  public static override properties = {
    author: { type: String, reflect: true },
    authorId: { type: String, attribute: 'author-id', reflect: true },
    authorName: { type: String, attribute: 'author-name' },
    status: { type: String, reflect: true },
    createdAt: { type: String, attribute: 'created-at' },
  };

  public author: ChatMessageAuthor = 'user';
  public authorId: string = '';
  public authorName: string = '';
  public status: ChatMessageStatus = 'complete';
  public createdAt: string = '';

  public override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('role', 'article');
  }

  /** The host is the article: labelled by its author, busy while streaming. */
  protected override updated(changed: PropertyValues<this>): void {
    super.updated(changed);
    setOptionalAttribute(this, 'aria-label', this.authorName || this.authorId);
    setOptionalAttribute(this, 'aria-busy', this.status === 'streaming' ? 'true' : '');
  }

  public override render(): TemplateResult {
    return html`
      <header class="meta">
        <span class="author">${this.authorName || this.authorId}</span>
        <time datetime=${this.createdAt.length > 0 ? this.createdAt : nothing}>
          ${this.createdAt}
        </time>
      </header>
      <div class="body">
        <slot></slot>
      </div>
    `;
  }
}

function setOptionalAttribute(element: Element, name: string, value: string): void {
  if (value.length > 0) {
    element.setAttribute(name, value);
  } else {
    element.removeAttribute(name);
  }
}
