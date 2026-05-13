import { LitElement, css, html } from 'lit';
import { defineOnce } from './define-once.js';

export class Choice extends LitElement {
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

  private handleClick = (): void => {
    this.dispatchEvent(
      new CustomEvent('choice-select', {
        detail: { value: this.value },
        bubbles: true,
        composed: true,
      }),
    );
  };

  public override render(): unknown {
    return html`<button type="button" @click=${this.handleClick}><slot></slot></button>`;
  }
}

defineOnce('choice-item', Choice);

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
    this.addEventListener('choice-select', this.handleSelect as EventListener);
  }

  public override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener('choice-select', this.handleSelect as EventListener);
  }

  private handleSelect = (event: Event): void => {
    const detail = (event as CustomEvent<{ value: string }>).detail;
    if (detail === undefined) {
      return;
    }
    this.value = detail.value;
    this.syncSelection();
    this.dispatchEvent(
      new CustomEvent('choice', {
        detail: { name: this.name, value: detail.value },
        bubbles: true,
        composed: true,
      }),
    );
  };

  private syncSelection(): void {
    for (const child of this.querySelectorAll('choice-item')) {
      const choiceElement = child as Choice;
      choiceElement.selected = choiceElement.value === this.value;
    }
  }

  public override render(): unknown {
    return html`<slot></slot>`;
  }
}

defineOnce('choice-group', ChoiceGroup);
