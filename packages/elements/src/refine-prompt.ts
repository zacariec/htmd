import { LitElement, css, html } from 'lit';
import type { TemplateResult } from 'lit';

import { HtmdElementEvents } from './events.js';
import type { RefineDetail } from './events.js';

/**
 * `<refine-prompt>` — a re-prompt affordance attached to a region.
 *
 * On submit, dispatches the `refine` event with `{ target, prompt }` and
 * disables itself. Completion contract: the consumer that handled the refine
 * calls `element.reset()` when the round-trip finishes (pass `true` to also
 * clear the textarea). The element never re-enables itself.
 */
export class RefinePrompt extends LitElement {
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
    submitLabel: { type: String, attribute: 'submit-label' },
    workingLabel: { type: String, attribute: 'working-label' },
    submitting: { state: true },
  };

  public target: string = '';
  public placeholder: string = 'Refine this section…';
  public submitLabel: string = 'Refine';
  public workingLabel: string = 'Working…';

  protected submitting: boolean = false;

  /** Re-enables the form after a completed refine round-trip. */
  public reset(clearInput: boolean = false): void {
    this.submitting = false;
    if (!clearInput) {
      return;
    }
    const textarea = this.renderRoot.querySelector('textarea');
    if (textarea !== null) {
      textarea.value = '';
    }
  }

  private readonly handleSubmit = (event: Event): void => {
    event.preventDefault();
    const textarea = this.renderRoot.querySelector('textarea') ?? undefined;
    if (textarea === undefined || textarea.value.trim().length === 0) {
      return;
    }
    this.submitting = true;
    const detail: RefineDetail = { target: this.target, prompt: textarea.value.trim() };
    this.dispatchEvent(
      new CustomEvent(HtmdElementEvents.Refine, {
        detail,
        bubbles: true,
        composed: true,
      }),
    );
  };

  public override render(): TemplateResult {
    return html`
      <div class="target">Refining: <code>${this.target}</code></div>
      <form @submit=${this.handleSubmit}>
        <textarea
          placeholder=${this.placeholder}
          aria-label=${this.placeholder}
          ?disabled=${this.submitting}
        ></textarea>
        <button type="submit" ?disabled=${this.submitting}>
          ${this.submitting ? this.workingLabel : this.submitLabel}
        </button>
      </form>
    `;
  }
}
