import { HtmdElementsLogger } from './internal/logger.js';

/**
 * Idempotent `customElements.define` — safe across module reloads, multiple
 * imports, HMR, and non-browser environments (Node/SSR imports are a no-op).
 * If the tag is already defined by a different class, logs a warning instead
 * of throwing.
 */
export function defineOnce(tag: string, ctor: CustomElementConstructor): void {
  if (typeof customElements === 'undefined') {
    return;
  }

  const existing = customElements.get(tag);
  if (existing === ctor) {
    return;
  }
  if (existing !== undefined) {
    HtmdElementsLogger.getInstance().warn(
      `custom element "${tag}" already defined by another class; skipping`,
    );
    return;
  }

  customElements.define(tag, ctor);
}
