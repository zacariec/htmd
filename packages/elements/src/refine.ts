import { LitElement, css, html } from 'lit';
import { defineOnce } from './define-once.js';

export class Refine extends LitElement {
  public static override styles = css`
    :host {
      display: block;
      margin-top: 12px;
      padding: 10px 12px;
      border: 1px dashed var(--htmd-border, #27272a);
      border-radius: 8px;
    }
    form {
      display: flex;
      gap: 8px;
      align-items: flex-end;
    }
    textarea {
      flex: 1;
      min-height: 40px;
      max-height: 120px;
      padding: 6px 8px;
      background: transparent;
      color: inherit;
      border: 1px solid var(--htmd-border, #27272a);
      border-radius: 4px;
      font: inherit;
      resize: vertical;
    }
    button {
      padding: 6px 14px;
      border: 1px solid var(--htmd-border, #27272a);
      border-radius: 4px;
      background: var(--htmd-accent, #6366f1);
      color: white;
      cursor: pointer;
      font: inherit;
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .target {
      font-size: 11px;
      opacity: 0.6;
      margin-bottom: 6px;
    }
  `;

  public static override properties = {
    target: { type: String, reflect: true },
    placeholder: { type: String },
    submitting: { type: Boolean, state: true },
  };

  public target: string = '';
  public placeholder: string = 'Refine this section…';
  protected submitting: boolean = false;

  private handleSubmit = (event: Event): void => {
    event.preventDefault();
    const textarea = this.renderRoot.querySelector('textarea');
    if (textarea === null || textarea.value.trim().length === 0) {
      return;
    }
    this.submitting = true;
    this.dispatchEvent(
      new CustomEvent('refine', {
        detail: { target: this.target, prompt: textarea.value.trim() },
        bubbles: true,
        composed: true,
      }),
    );
  };

  public override render(): unknown {
    return html`
      <div class="target">Refining: <code>${this.target}</code></div>
      <form @submit=${this.handleSubmit}>
        <textarea placeholder=${this.placeholder} ?disabled=${this.submitting}></textarea>
        <button type="submit" ?disabled=${this.submitting}>
          ${this.submitting ? 'Working…' : 'Refine'}
        </button>
      </form>
    `;
  }
}

defineOnce('refine-prompt', Refine);
