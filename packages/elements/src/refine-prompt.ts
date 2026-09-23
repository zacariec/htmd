import { ComponentEvents, RefineDetail, originRegion } from '@htmdjs/contracts';
import type { InteractionValue, StatefulComponent } from '@htmdjs/contracts';
import { LitElement, css, html } from 'lit';
import type { TemplateResult } from 'lit';
import { z } from 'zod';

import { recordRefineOrigin } from './complete-refine.js';
import { HtmdElementsLogger } from './internal/logger.js';

const RefinePromptState = z.object({ draft: z.string() });

/**
 * `<refine-prompt>` — a re-prompt affordance attached to a region.
 *
 * On submit, dispatches the `refine` intent with `{ target, prompt, region }`
 * and disables itself; nothing is emitted unless the detail validates.
 * Completion contract: the consumer that handled the refine calls
 * `element.reset()` (or `completeRefine(event)`) when the round-trip
 * finishes (pass `true` to also clear the textarea). The element never
 * re-enables itself. The draft lives in the textarea, so source updates
 * never reset it.
 *
 * Interaction state (`StatefulComponent`): `{ draft }` while the textarea
 * has text. Restoring sets the draft; it never submits.
 */
export class RefinePrompt extends LitElement implements StatefulComponent {
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

  /** Draft restored before the textarea rendered; applied on first render. */
  private pendingDraft: string | undefined = undefined;

  /** Re-enables the form after a completed refine round-trip. */
  public reset(clearInput: boolean = false): void {
    this.submitting = false;
    if (!clearInput) {
      return;
    }
    this.pendingDraft = undefined;
    const textarea = this.renderRoot.querySelector('textarea');
    if (textarea !== null) {
      textarea.value = '';
    }
  }

  public htmdSnapshot(): InteractionValue | undefined {
    const draft = this.hasUpdated
      ? (this.renderRoot.querySelector('textarea')?.value ?? '')
      : (this.pendingDraft ?? '');
    return draft.length > 0 ? { draft } : undefined;
  }

  public htmdRestore(state: InteractionValue): void {
    const parsed = RefinePromptState.safeParse(state);
    if (!parsed.success) {
      return;
    }
    const textarea = this.hasUpdated ? this.renderRoot.querySelector('textarea') : null;
    if (textarea === null) {
      this.pendingDraft = parsed.data.draft;
      return;
    }
    textarea.value = parsed.data.draft;
  }

  protected override firstUpdated(): void {
    const textarea = this.renderRoot.querySelector('textarea');
    if (this.pendingDraft !== undefined && textarea !== null) {
      textarea.value = this.pendingDraft;
    }
    this.pendingDraft = undefined;
  }

  private readonly handleSubmit = (event: Event): void => {
    event.preventDefault();
    const textarea = this.renderRoot.querySelector('textarea') ?? undefined;
    if (this.submitting || textarea === undefined) {
      return;
    }
    const prompt = textarea.value.trim();
    if (prompt.length === 0) {
      return;
    }
    const detail = RefineDetail.safeParse({
      target: this.target,
      prompt,
      region: originRegion(this),
    });
    if (!detail.success) {
      HtmdElementsLogger.getInstance().warn(
        `refine-prompt target "${this.target}" or its region is not a valid region id; not submitting`,
      );
      return;
    }
    this.submitting = true;
    const refine = new CustomEvent<RefineDetail>(ComponentEvents.Refine, {
      detail: detail.data,
      bubbles: true,
      composed: true,
    });
    recordRefineOrigin(refine, this);
    this.dispatchEvent(refine);
  };

  public override render(): TemplateResult {
    return html`
      <div class="target">Refining: <code>${this.target}</code></div>
      <form aria-busy=${this.submitting ? 'true' : 'false'} @submit=${this.handleSubmit}>
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
