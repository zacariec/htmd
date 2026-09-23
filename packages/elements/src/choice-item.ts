import { LitElement, css, html } from 'lit';
import type { TemplateResult } from 'lit';

import { CHOICE_SELECT_EVENT } from './internal/choice-select.js';

/**
 * `<choice-item>` — a single option inside a `<choice-group>`.
 *
 * Dispatches the internal `choice-select` event; the enclosing group turns it
 * into the public `choice` intent. Selection and tab order are owned by the
 * group; focusing the item focuses its radio button.
 */
export class ChoiceItem extends LitElement {
  public static override shadowRootOptions: ShadowRootInit = {
    ...LitElement.shadowRootOptions,
    delegatesFocus: true,
  };

  public static override styles = css`
    :host {
      display: inline-block;
    }
    button {
      padding: 8px 14px;
      border-radius: 999px;
      border: 1px solid var(--htmd-border, #27272a);
      background: var(--htmd-choice-bg, transparent);
      color: inherit;
      cursor: pointer;
      font: inherit;
    }
    button:hover {
      background: var(--htmd-choice-hover, rgba(255, 255, 255, 0.05));
    }
    button:focus-visible {
      outline: 2px solid var(--htmd-accent, #6366f1);
      outline-offset: 2px;
    }
    :host([selected]) button {
      background: var(--htmd-choice-selected, rgba(255, 255, 255, 0.12));
      border-color: var(--htmd-accent, #6366f1);
    }
  `;

  public static override properties = {
    value: { type: String, reflect: true },
    selected: { type: Boolean, reflect: true },
    tabbable: { type: Boolean, attribute: false },
  };

  public value: string = '';
  public selected: boolean = false;
  /** Whether the item is the group's tab stop. Set by the enclosing group. */
  public tabbable: boolean = true;

  /** Focuses the radio button, not the host. */
  public override focus(options?: FocusOptions): void {
    const button = this.shadowRoot?.querySelector('button') ?? undefined;
    if (button === undefined) {
      super.focus(options);
      return;
    }
    button.focus(options);
  }

  private readonly handleClick = (): void => {
    this.dispatchEvent(new CustomEvent(CHOICE_SELECT_EVENT, { bubbles: true }));
  };

  public override render(): TemplateResult {
    return html`
      <button
        type="button"
        role="radio"
        aria-checked=${this.selected ? 'true' : 'false'}
        tabindex=${this.tabbable ? '0' : '-1'}
        @click=${this.handleClick}
      >
        <slot></slot>
      </button>
    `;
  }
}
