import { isAsciiDigit, isAsciiLowerLetter } from './char-predicates.js';

/**
 * A custom element tag must contain at least one hyphen (per the Custom
 * Elements spec) and must not start with one. Reserved names (`annotation-xml`,
 * `color-profile`, `font-face`, `font-face-src`, `font-face-uri`, `font-face-format`,
 * `font-face-name`, `missing-glyph`) are rejected.
 *
 * Validation walks the string character-by-character — no regex.
 */

const RESERVED_NAMES: ReadonlySet<string> = new Set([
  'annotation-xml',
  'color-profile',
  'font-face',
  'font-face-src',
  'font-face-uri',
  'font-face-format',
  'font-face-name',
  'missing-glyph',
]);

function isLowerAlphaNumeric(char: string | undefined): boolean {
  return isAsciiLowerLetter(char) || isAsciiDigit(char);
}

export function isCustomElementTag(tag: string): boolean {
  if (tag.length === 0) {
    return false;
  }

  if (RESERVED_NAMES.has(tag)) {
    return false;
  }

  if (!isAsciiLowerLetter(tag[0])) {
    return false;
  }

  let sawHyphen = false;
  let prevWasHyphen = false;

  for (let i = 1; i < tag.length; i += 1) {
    const char = tag[i];

    if (char === '-') {
      if (prevWasHyphen) {
        return false;
      }
      sawHyphen = true;
      prevWasHyphen = true;
      continue;
    }

    if (!isLowerAlphaNumeric(char)) {
      return false;
    }

    prevWasHyphen = false;
  }

  if (prevWasHyphen) {
    return false;
  }

  return sawHyphen;
}
