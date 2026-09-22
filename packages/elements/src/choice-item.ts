import { LitElement, css, html } from 'lit';
import type { TemplateResult } from 'lit';

import { HtmdElementEvents } from './events.js';
import type { ChoiceSelectDetail } from './events.js';

/**
 * `<choice-item>` — a single option inside a `<choice-group>`.
 *
 * Dispatches the internal `choice-select` event; the enclosing group turns it
 * into the public `choice` event.
 */
export class ChoiceItem extends LitElement {
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
  };

  public value: string = '';
  public selected: boolean = false;

  private readonly handleClick = (): void => {
    const detail: ChoiceSelectDetail = { value: this.value };
    this.dispatchEvent(
      new CustomEvent(HtmdElementEvents.ChoiceSelect, {
        detail,
        bubbles: true,
        composed: true,
      }),
    );
  };

  public override render(): TemplateResult {
    return html`
      <button
        type="button"
        role="radio"
        aria-checked=${this.selected ? 'true' : 'false'}
        @click=${this.handleClick}
      >
        <slot></slot>
      </button>
    `;
  }
}
