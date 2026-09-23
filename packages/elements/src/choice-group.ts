import { ComponentEvents, originRegion } from '@htmdjs/contracts';
import type { ChoiceDetail } from '@htmdjs/contracts';
import { LitElement, css, html } from 'lit';
import type { PropertyValues, TemplateResult } from 'lit';

import { ChoiceItem } from './choice-item.js';
import { CHOICE_SELECT_EVENT } from './internal/choice-select.js';

/**
 * `<choice-group>` — a single-selection radio group of `<choice-item>`s.
 *
 * `value` is initial-owned: the source sets the first selection, afterwards
 * the user owns it. The current value applies to items that arrive later.
 * One item is in the tab order (the selected one, else the first); arrow
 * keys move focus and selection, Home/End jump to the ends. Every user
 * selection emits the public `choice` intent.
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
    this.addEventListener(CHOICE_SELECT_EVENT, this.handleSelect);
    this.addEventListener('keydown', this.handleKeydown);
  }

  public override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener(CHOICE_SELECT_EVENT, this.handleSelect);
    this.removeEventListener('keydown', this.handleKeydown);
  }

  protected override firstUpdated(): void {
    this.syncSelection();
  }

  protected override updated(changed: PropertyValues<this>): void {
    super.updated(changed);
    if (changed.has('value')) {
      this.syncSelection();
    }
  }

  private readonly handleSelect = (event: Event): void => {
    event.stopPropagation();
    const item = event.target;
    if (item instanceof ChoiceItem && this.items().includes(item)) {
      this.select(item, true);
    }
  };

  private readonly handleKeydown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    const items = this.items();
    const path = event.composedPath();
    const current = items.findIndex((item) => path.includes(item));
    if (current === -1) {
      return;
    }
    const index = nextIndex(event.key, current, items.length);
    const next = index === undefined ? undefined : items[index];
    if (next === undefined) {
      return;
    }
    event.preventDefault();
    this.select(next, false);
    next.focus();
  };

  /** Items owned by this group; items of nested groups are excluded. */
  private items(): ChoiceItem[] {
    const items: ChoiceItem[] = [];
    for (const element of this.querySelectorAll('choice-item')) {
      if (element instanceof ChoiceItem && element.closest('choice-group') === this) {
        items.push(element);
      }
    }
    return items;
  }

  /** Activation (click, Space, Enter) always emits; keyboard moves emit on change. */
  private select(item: ChoiceItem, activation: boolean): void {
    const changed = item.value !== this.value;
    this.value = item.value;
    this.syncSelection();
    if (!changed && !activation) {
      return;
    }
    const detail: ChoiceDetail = { name: this.name, value: item.value, region: originRegion(this) };
    this.dispatchEvent(
      new CustomEvent<ChoiceDetail>(ComponentEvents.Choice, {
        detail,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private syncSelection(): void {
    const items = this.items();
    const selected = items.find((item) => item.value === this.value);
    const tabStop = selected ?? items[0];
    for (const item of items) {
      item.selected = item === selected;
      item.tabbable = item === tabStop;
    }
  }

  public override render(): TemplateResult {
    return html`<slot @slotchange=${this.syncSelection}></slot>`;
  }
}

function nextIndex(key: string, current: number, count: number): number | undefined {
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (current + 1) % count;
    case 'ArrowLeft':
    case 'ArrowUp':
      return (current - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return undefined;
  }
}
