import { registerHtmdElements } from '@zacariec/htmd-elements';

/**
 * Registers the base element set exactly once. Called by the React entrypoints
 * on first mount so consumers of `@zacariec/htmd-react` never have to think about
 * `registerHtmdElements()` themselves.
 */
let registered = false;

export function ensureHtmdElementsRegistered(): void {
  if (registered) {
    return;
  }
  registered = registerHtmdElements();
}
