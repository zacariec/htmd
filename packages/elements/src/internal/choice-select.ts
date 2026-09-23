/**
 * Internal: a `<choice-item>` was activated. The enclosing `<choice-group>`
 * stops it and emits the public `choice` intent; it never leaves the group.
 * The event target is the activated item.
 */
export const CHOICE_SELECT_EVENT = 'choice-select';
