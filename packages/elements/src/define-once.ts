/**
 * Idempotent `customElements.define` — safe across module reloads, multiple
 * imports, and HMR. If the tag is already defined by a different class, logs
 * a warning instead of throwing.
 */
export function defineOnce(tag: string, ctor: CustomElementConstructor): void {
  const existing = customElements.get(tag);
  if (existing === ctor) {
    return;
  }
  if (existing !== undefined) {
    console.warn(
      `[htmd/elements] custom element "${tag}" already defined by another class; skipping`,
    );
    return;
  }
  customElements.define(tag, ctor);
}
