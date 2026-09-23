import type { RefinePrompt } from './refine-prompt.js';

export interface CompleteRefineOptions {
  /** Also clear the draft. Defaults to false. */
  readonly clearInput?: boolean;
}

/**
 * `refine` events dispatched by a `<refine-prompt>`, mapped to their origin.
 * Unlike `composedPath()`, which is empty once dispatch ends, this still
 * answers when the host completes the round-trip asynchronously, including
 * for prompts inside shadow trees (whose events are retargeted).
 */
const origins = new WeakMap<Event, RefinePrompt>();

export function recordRefineOrigin(event: Event, prompt: RefinePrompt): void {
  origins.set(event, prompt);
}

/**
 * Ends the submission that dispatched `event` (a `refine` intent), re-enabling
 * its `<refine-prompt>`. Returns whether the event came from one.
 */
export function completeRefine(event: Event, options: CompleteRefineOptions = {}): boolean {
  const prompt = origins.get(event);
  if (prompt === undefined) {
    return false;
  }
  prompt.reset(options.clearInput === true);
  return true;
}
