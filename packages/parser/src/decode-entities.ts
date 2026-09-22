/**
 * Attribute-value entity decoder — the inverse of the escaping a `.htmd`
 * serializer applies when it writes an attribute out.
 *
 * Deliberately narrow. There is no HTML5 named-entity table here and no
 * dependency: only the five named references a serializer needs to emit, plus
 * decimal and hexadecimal numeric references. Anything else (`&nbsp;`,
 * `&notanentity`, a bare `&`) is left exactly as written, because a `.htmd`
 * attribute is data, not markup, and silently rewriting text nobody escaped is
 * worse than leaving it alone.
 *
 * The decoder accepts more than the serializer emits — `escapeText` escapes `&`
 * and `<` but not `>`, and `escapeAttribute` adds `"` on top. That asymmetry is
 * intentional: `>` and `'` are legal literals inside a double-quoted attribute
 * value, so there is nothing to fix on the escape side, but a decoder that
 * refused to read them would choke on hand-written and third-party source.
 *
 * Single pass, always. Chained replacement would decode `&amp;lt;` to `<`; it
 * has to decode to the literal text `&lt;`, because the author escaped the
 * ampersand to say exactly that.
 */

const ENTITY_REFERENCE = /&(?:#[xX]([0-9a-fA-F]+)|#([0-9]+)|([a-zA-Z]+));/g;

const AMPERSAND = '&';
const HEX_RADIX = 16;
const DECIMAL_RADIX = 10;
const MAX_CODE_POINT = 0x10ffff;
const SURROGATE_START = 0xd800;
const SURROGATE_END = 0xdfff;

const NAMED_REFERENCES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/**
 * Returns the character for a numeric reference, or undefined when the code
 * point is unpaired-surrogate, out of range, or `NUL` — all of which stay as
 * written rather than becoming a replacement character.
 */
function characterFromCodePoint(codePoint: number): string | undefined {
  if (!Number.isFinite(codePoint) || codePoint <= 0 || codePoint > MAX_CODE_POINT) {
    return undefined;
  }
  if (codePoint >= SURROGATE_START && codePoint <= SURROGATE_END) {
    return undefined;
  }

  return String.fromCodePoint(codePoint);
}

export function decodeEntities(value: string): string {
  if (!value.includes(AMPERSAND)) {
    return value;
  }

  return value.replace(
    ENTITY_REFERENCE,
    (match: string, hex?: string, decimal?: string, name?: string): string => {
      if (hex !== undefined) {
        return characterFromCodePoint(Number.parseInt(hex, HEX_RADIX)) ?? match;
      }
      if (decimal !== undefined) {
        return characterFromCodePoint(Number.parseInt(decimal, DECIMAL_RADIX)) ?? match;
      }
      if (name === undefined) {
        return match;
      }

      return Object.prototype.hasOwnProperty.call(NAMED_REFERENCES, name)
        ? (NAMED_REFERENCES[name] ?? match)
        : match;
    },
  );
}
