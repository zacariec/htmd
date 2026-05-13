/**
 * A custom element tag must contain at least one hyphen (per the Custom
 * Elements spec) and must not start with one. Reserved names (`annotation-xml`,
 * `color-profile`, `font-face`, `font-face-src`, `font-face-uri`, `font-face-format`,
 * `font-face-name`, `missing-glyph`) are rejected.
 */

const RESERVED_NAMES = new Set([
  'annotation-xml',
  'color-profile',
  'font-face',
  'font-face-src',
  'font-face-uri',
  'font-face-format',
  'font-face-name',
  'missing-glyph',
]);

const VALID_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/;

export function isCustomElementTag(tag: string): boolean {
  if (tag.length === 0) {
    return false;
  }

  if (RESERVED_NAMES.has(tag)) {
    return false;
  }

  return VALID_NAME.test(tag);
}
