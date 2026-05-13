/**
 * Character predicates used by the tokenizer and validators.
 *
 * Pure utility functions — no regex, no allocation, no state. Each function
 * accepts `string | undefined` so callers can pass `cursor.peek()` directly
 * without an `=== undefined` guard at every call site.
 */

export function isAsciiLowerLetter(char: string | undefined): boolean {
  if (char === undefined) {
    return false;
  }
  return char >= 'a' && char <= 'z';
}

export function isAsciiUpperLetter(char: string | undefined): boolean {
  if (char === undefined) {
    return false;
  }
  return char >= 'A' && char <= 'Z';
}

export function isAsciiLetter(char: string | undefined): boolean {
  return isAsciiLowerLetter(char) || isAsciiUpperLetter(char);
}

export function isAsciiDigit(char: string | undefined): boolean {
  if (char === undefined) {
    return false;
  }
  return char >= '0' && char <= '9';
}

export function isTagNameStart(char: string | undefined): boolean {
  return isAsciiLetter(char);
}

export function isTagNameChar(char: string | undefined): boolean {
  return isAsciiLetter(char) || isAsciiDigit(char) || char === '-';
}

export function isAttrNameStart(char: string | undefined): boolean {
  return isAsciiLetter(char) || char === '_';
}

export function isAttrNameChar(char: string | undefined): boolean {
  return isAsciiLetter(char) || isAsciiDigit(char) || char === '-' || char === '_' || char === ':';
}

export function isWhitespace(char: string | undefined): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f';
}
