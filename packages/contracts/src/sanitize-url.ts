/**
 * Shared URL scheme gate for `.htmd` components.
 *
 * `.htmd` attribute values are producer-controlled (usually model-authored),
 * so every URL that reaches an `href` or `src` binding goes through here
 * before host authorization.
 *
 * Policy:
 * - Relative URLs, `#` fragments, and `?` queries are allowed.
 * - Absolute URLs are allowed only for `http:`, `https:`, `mailto:`, `tel:`.
 * - Everything else (`javascript:`, `data:`, `vbscript:`, `blob:`, ...)
 *   is rejected.
 *
 * Control characters (including tab / newline / carriage return) are stripped
 * before scheme detection, mirroring the WHATWG URL parser — this closes the
 * `java\tscript:` bypass.
 */

const ALLOWED_SCHEMES: ReadonlySet<string> = new Set(['http', 'https', 'mailto', 'tel']);

function stripControlCharacters(value: string): string {
  let result = '';
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) {
      continue;
    }
    result += char;
  }
  return result;
}

function isSchemeStart(char: string | undefined): boolean {
  if (char === undefined) {
    return false;
  }
  return (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z');
}

function isSchemeChar(char: string | undefined): boolean {
  if (char === undefined) {
    return false;
  }
  return (
    isSchemeStart(char) ||
    (char >= '0' && char <= '9') ||
    char === '+' ||
    char === '-' ||
    char === '.'
  );
}

/**
 * Extracts the URL scheme (without the trailing colon), or undefined when the
 * value has no scheme and is therefore relative.
 */
function detectScheme(url: string): string | undefined {
  if (!isSchemeStart(url[0])) {
    return undefined;
  }

  let index = 1;
  while (isSchemeChar(url[index])) {
    index += 1;
  }

  if (url[index] !== ':') {
    return undefined;
  }

  return url.slice(0, index).toLowerCase();
}

/**
 * Returns the URL when it passes the allowlist, or undefined when it must not
 * be rendered. Callers bind `undefined` to `nothing` (Lit) or skip the
 * attribute entirely.
 */
export function sanitizeUrl(raw: string): string | undefined {
  const cleaned = stripControlCharacters(raw).trim();

  if (cleaned.length === 0) {
    return undefined;
  }

  const scheme = detectScheme(cleaned);
  if (scheme === undefined) {
    return cleaned;
  }

  if (ALLOWED_SCHEMES.has(scheme)) {
    return cleaned;
  }

  return undefined;
}
