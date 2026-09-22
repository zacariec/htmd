/**
 * Event names dispatched by `@zacariec/htmd-elements` components.
 *
 * Every event bubbles and is composed, so consumers listen on any ancestor
 * (typically the region root or the document).
 */

export enum HtmdElementEvents {
  /** Internal: a `<choice-item>` was clicked. Consumed by `<choice-group>`. */
  ChoiceSelect = 'choice-select',
  /** Public: a `<choice-group>` selection changed. */
  Choice = 'choice',
  /** Public: a `<refine-prompt>` was submitted. */
  Refine = 'refine',
}

export interface ChoiceSelectDetail {
  readonly value: string;
}

export interface ChoiceDetail {
  readonly name: string;
  readonly value: string;
}

export interface RefineDetail {
  readonly target: string;
  readonly prompt: string;
}
