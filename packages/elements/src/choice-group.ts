import { LitElement, css, html } from 'lit';
import type { TemplateResult } from 'lit';

import type { ChoiceItem } from './choice-item.js';
import { HtmdElementEvents } from './events.js';
import type { ChoiceDetail, ChoiceSelectDetail } from './events.js';

/**
 * `<choice-group>` — a set of `<choice-item>` children.
 *
 * Listens for the internal `choice-select` event from its items (stopping it
 * there so nested groups stay isolated) and dispatches the public `choice`
 * event with `{ name, value }`.
 */
export class ChoiceGroup extends LitElement {
  public static override styles = css`
    :host {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
  `;

  public static override properties = {
    name: { type: String, reflect: true },
    value: { type: String, reflect: true },
  };

  public name: string = '';
  public value: string = '';

  public override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('role', 'radiogroup');
    this.addEventListener(HtmdElementEvents.ChoiceSelect, this.handleSelect as EventListener);
  }

  public override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener(HtmdElementEvents.ChoiceSelect, this.handleSelect as EventListener);
  }

  private readonly handleSelect = (event: Event): void => {
    event.stopPropagation();
    const detail = (event as CustomEvent<ChoiceSelectDetail>).detail;
    if (detail === undefined) {
      return;
    }
    this.value = detail.value;
    this.syncSelection();
    const choiceDetail: ChoiceDetail = { name: this.name, value: detail.value };
    this.dispatchEvent(
      new CustomEvent(HtmdElementEvents.Choice, {
        detail: choiceDetail,
        bubbles: true,
        composed: true,
      }),
    );
  };

  private syncSelection(): void {
    for (const child of this.querySelectorAll('choice-item')) {
      if (child.closest('choice-group') !== this) {
        continue;
      }
      const choiceElement = child as ChoiceItem;
      choiceElement.selected = choiceElement.value === this.value;
    }
  }

  public override render(): TemplateResult {
    return html`<slot></slot>`;
  }
}
