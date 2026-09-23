import {
  isAttrNameChar,
  isAttrNameStart,
  isTagNameChar,
  isTagNameStart,
  isWhitespace,
} from './char-predicates.js';
import { Cursor } from './cursor.js';
import { decodeEntities } from './decode-entities.js';
import { isCustomElementTag } from './is-custom-element-tag.js';
import { DEFAULT_RAW_TEXT_TAGS, DiagnosticCode, DiagnosticSeverity } from './types.js';
import type { Diagnostic, ParseOptions } from './types.js';

/**
 * Tokenizer — finds top-level custom-element openings in `.htmd` source.
 *
 * Intentionally a flat scan, not a full HTML parser. It locates custom-element
 * regions and emits everything else as markdown tokens for the consumer's
 * markdown renderer.
 *
 * Code fences (line-anchored, three or more backticks) and inline code spans
 * suppress tokenizing so a custom-element literal inside code stays markdown.
 *
 * Children of raw-text tags (`ParseOptions.rawTextTags`, by default
 * `<htmd-fragment>` and `<code-block>`) are never scanned: everything up to the
 * matching closing tag is one markdown token.
 *
 * The tokenizer reports forbidden constructs (`<script>`, `on*=` attributes,
 * `javascript:` URLs) as diagnostics. It never rewrites the source — the
 * element layer enforces; the tokenizer reports.
 *
 * Singleton: a `Tokenizer` instance holds no per-source state — each call to
 * `tokenize(source)` constructs its own `Cursor`.
 */

export interface MarkdownToken {
  readonly kind: 'markdown';
  readonly value: string;
  readonly start: number;
  readonly end: number;
}

export interface ElementOpenToken {
  readonly kind: 'element-open';
  readonly tag: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly selfClosing: boolean;
  readonly start: number;
  readonly end: number;
}

export interface ElementCloseToken {
  readonly kind: 'element-close';
  readonly tag: string;
  readonly start: number;
  readonly end: number;
}

export type Token = MarkdownToken | ElementOpenToken | ElementCloseToken;

export interface TokenizeResult {
  readonly tokens: readonly Token[];
  readonly diagnostics: readonly Diagnostic[];
  readonly pending: boolean;
}

interface ScannedTag {
  readonly token: ElementOpenToken | ElementCloseToken;
  readonly diagnostics: readonly Diagnostic[];
}

interface FenceMarker {
  readonly marker: string;
  readonly length: number;
  readonly restIsBlank: boolean;
}

const BACKTICK = '`';
const TAG_OPEN = '<';
const TAG_CLOSE = '>';
const SLASH = '/';
const DOUBLE_QUOTE = '"';
const SINGLE_QUOTE = "'";
const EQUALS = '=';
const NEWLINE = '\n';
const MIN_FENCE_LENGTH = 3;
const MAX_FENCE_INDENT = 3;
const JAVASCRIPT_SCHEME = 'javascript:';

const FORBIDDEN_TAGS: ReadonlySet<string> = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'link',
  'meta',
  'base',
  'form',
]);

export class Tokenizer {
  private static instance: Tokenizer | undefined;

  private constructor() {}

  public static getInstance(): Tokenizer {
    if (Tokenizer.instance === undefined) {
      Tokenizer.instance = new Tokenizer();
    }
    return Tokenizer.instance;
  }

  public tokenize(source: string, options: ParseOptions = {}): TokenizeResult {
    const cursor = new Cursor(source);
    const lowerSource = source.toLowerCase();
    const tokens: Token[] = [];
    const diagnostics: Diagnostic[] = [];
    let markdownStart = 0;
    let pending = false;
    const streaming = options.streaming === true;
    const rawTextTags = options.rawTextTags ?? DEFAULT_RAW_TEXT_TAGS;
    let inFence = false;
    let fenceLength = 0;
    let fenceMarker = BACKTICK;

    while (!cursor.eof()) {
      if (this.atLineStart(cursor)) {
        const marker = this.tryScanFenceMarker(cursor);
        if (marker !== undefined) {
          if (!inFence) {
            inFence = true;
            fenceLength = marker.length;
            fenceMarker = marker.marker;
          } else if (
            marker.marker === fenceMarker &&
            marker.length >= fenceLength &&
            marker.restIsBlank
          ) {
            inFence = false;
          }
          continue;
        }
      }

      if (inFence) {
        this.skipPastLineEnd(cursor);
        continue;
      }

      const char = cursor.peek();

      // Markdown escapes make the following delimiter literal.
      if (
        char === '\\' &&
        (cursor.peek(1) === BACKTICK || cursor.peek(1) === TAG_OPEN || cursor.peek(1) === '\\')
      ) {
        cursor.advance(2);
        continue;
      }

      if (char === BACKTICK) {
        pending = this.skipInlineCodeSpan(cursor, source, streaming) || pending;
        continue;
      }

      if (char === 'j' || char === 'J') {
        this.checkJavascriptScheme(cursor, lowerSource, diagnostics);
        continue;
      }

      if (char !== TAG_OPEN) {
        cursor.advance(1);
        continue;
      }

      const tagStart = cursor.position();
      const scanned = this.scanTag(cursor);
      if (scanned === 'incomplete') {
        if (streaming) {
          pending = true;
          break;
        }
        this.checkForbiddenTag(cursor, diagnostics);
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          code: DiagnosticCode.IncompleteTag,
          message: 'incomplete tag',
          start: tagStart,
          end: source.length,
        });
        cursor.advance(source.length - tagStart);
        break;
      }
      if (scanned === undefined) {
        this.checkForbiddenTag(cursor, diagnostics);
        cursor.advance(1);
        continue;
      }

      if (tagStart > markdownStart) {
        tokens.push({
          kind: 'markdown',
          value: cursor.slice(markdownStart, tagStart),
          start: markdownStart,
          end: tagStart,
        });
      }

      tokens.push(scanned.token);
      diagnostics.push(...scanned.diagnostics);
      markdownStart = cursor.position();

      const opened = scanned.token;
      if (opened.kind === 'element-open' && !opened.selfClosing && rawTextTags.has(opened.tag)) {
        this.skipRawText(cursor, lowerSource, opened.tag);
      }
    }

    if (cursor.position() > markdownStart) {
      tokens.push({
        kind: 'markdown',
        value: cursor.slice(markdownStart, cursor.position()),
        start: markdownStart,
        end: cursor.position(),
      });
    }

    return { tokens, diagnostics, pending: streaming && (pending || inFence) };
  }

  private atLineStart(cursor: Cursor): boolean {
    return cursor.position() === 0 || cursor.peek(-1) === NEWLINE;
  }

  /**
   * At a line start, attempts to consume a fence marker line: up to three
   * spaces of indent, then three or more backticks or tildes, then the rest of
   * the line (info string for openers, hopefully blank for closers). Consumes through
   * the line ending on match; restores the cursor on no match.
   */
  private tryScanFenceMarker(cursor: Cursor): FenceMarker | undefined {
    const checkpoint = cursor.save();

    let indent = 0;
    while (cursor.peek() === ' ' && indent < MAX_FENCE_INDENT) {
      cursor.advance(1);
      indent += 1;
    }

    const marker = cursor.peek();
    if (marker !== BACKTICK && marker !== '~') {
      cursor.restore(checkpoint);
      return undefined;
    }
    let length = 0;
    while (cursor.peek() === marker) {
      cursor.advance(1);
      length += 1;
    }

    if (length < MIN_FENCE_LENGTH) {
      cursor.restore(checkpoint);
      return undefined;
    }

    let restIsBlank = true;
    while (!cursor.eof() && cursor.peek() !== NEWLINE) {
      if (marker === BACKTICK && cursor.peek() === BACKTICK) {
        cursor.restore(checkpoint);
        return undefined;
      }
      if (!isWhitespace(cursor.peek())) {
        restIsBlank = false;
      }
      cursor.advance(1);
    }
    if (!cursor.eof()) {
      cursor.advance(1);
    }

    return { marker, length, restIsBlank };
  }

  private skipPastLineEnd(cursor: Cursor): void {
    while (!cursor.eof() && cursor.peek() !== NEWLINE) {
      cursor.advance(1);
    }
    if (!cursor.eof()) {
      cursor.advance(1);
    }
  }

  /**
   * At a backtick run, attempts a CommonMark-style inline code span: a run of
   * N backticks closed by the next run of exactly N backticks within the same
   * paragraph (a blank line terminates the search). On match the cursor lands
   * after the closing run. An unmatched run is literal on final parse; while
   * streaming, suppress tag scanning until the paragraph can be resolved.
   */
  private skipInlineCodeSpan(cursor: Cursor, source: string, streaming: boolean): boolean {
    let runLength = 0;
    while (cursor.peek(runLength) === BACKTICK) {
      runLength += 1;
    }

    const searchStart = cursor.position() + runLength;
    const closeIndex = findBacktickRun(source, searchStart, runLength);

    if (closeIndex === undefined) {
      cursor.advance(runLength);
      if (streaming) {
        // An unfinished code span must not briefly instantiate its tag literals.
        // A blank line ends the paragraph, so it cannot acquire a closing run.
        while (!cursor.eof()) {
          if (
            cursor.peek() === NEWLINE &&
            isBlankLineAhead(source, cursor.position() + 1) &&
            source.indexOf(NEWLINE, cursor.position() + 1) !== -1
          ) {
            cursor.restore(searchStart);
            return false;
          }
          cursor.advance(1);
        }
        return true;
      }
      return false;
    }

    cursor.advance(closeIndex + runLength - cursor.position());
    return false;
  }

  private checkJavascriptScheme(
    cursor: Cursor,
    lowerSource: string,
    diagnostics: Diagnostic[],
  ): void {
    const position = cursor.position();
    if (!lowerSource.startsWith(JAVASCRIPT_SCHEME, position)) {
      cursor.advance(1);
      return;
    }
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      code: DiagnosticCode.ForbiddenUrlScheme,
      message: '"javascript:" URLs are forbidden in .htmd documents',
      start: position,
      end: position + JAVASCRIPT_SCHEME.length,
    });
    cursor.advance(JAVASCRIPT_SCHEME.length);
  }

  /**
   * Called when `scanTag` failed at a `<`. If the character sequence looks
   * like a forbidden HTML tag (open or close), reports an error diagnostic.
   * Never consumes input — the caller advances past the `<`.
   */
  private checkForbiddenTag(cursor: Cursor, diagnostics: Diagnostic[]): void {
    const start = cursor.position();
    let offset = 1;
    if (cursor.peek(offset) === SLASH) {
      offset += 1;
    }
    if (!isTagNameStart(cursor.peek(offset))) {
      return;
    }
    const nameStart = offset;
    while (isTagNameChar(cursor.peek(offset))) {
      offset += 1;
    }
    const name = cursor.slice(start + nameStart, start + offset).toLowerCase();
    if (!FORBIDDEN_TAGS.has(name)) {
      return;
    }
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      code: DiagnosticCode.ForbiddenTag,
      message: `forbidden HTML tag <${name}> — .htmd allows custom elements only`,
      start,
      end: start + offset,
    });
  }

  /**
   * Raw-text children are an opaque payload. Jump the cursor to the closing
   * tag for `tag` without scanning the payload for elements or code. The
   * skipped span flushes as a single markdown token when the close tag is
   * scanned (or at EOF if the close tag is missing). A possible closing-tag
   * prefix at EOF stops the skip so streaming can buffer it.
   */
  private skipRawText(cursor: Cursor, lowerSource: string, tag: string): void {
    const close = `</${tag}`;
    let candidate = lowerSource.indexOf(TAG_OPEN, cursor.position());
    while (candidate !== -1) {
      if (
        lowerSource.length - candidate < close.length &&
        close.startsWith(lowerSource.slice(candidate))
      ) {
        cursor.restore(candidate);
        return;
      }
      if (lowerSource.startsWith(close, candidate)) {
        cursor.restore(candidate);
        const scanned = this.scanTag(cursor);
        if (
          scanned === 'incomplete' ||
          (scanned !== undefined &&
            scanned.token.kind === 'element-close' &&
            scanned.token.tag === tag)
        ) {
          cursor.restore(candidate);
          return;
        }
      }
      candidate = lowerSource.indexOf(TAG_OPEN, candidate + 1);
    }
    cursor.restore(cursor.sourceLength());
  }

  /**
   * Attempts to scan a custom-element open or close tag at the current cursor
   * position. Returns the token (plus any attribute diagnostics) and leaves
   * the cursor after `>`, or returns undefined and restores the cursor.
   */
  private scanTag(cursor: Cursor): ScannedTag | 'incomplete' | undefined {
    const checkpoint = cursor.save();

    if (cursor.peek() !== TAG_OPEN) {
      return undefined;
    }
    cursor.advance(1);

    const isClose = cursor.peek() === SLASH;
    if (isClose) {
      cursor.advance(1);
    }

    if (cursor.eof()) {
      cursor.restore(checkpoint);
      return 'incomplete';
    }

    if (!isTagNameStart(cursor.peek())) {
      cursor.restore(checkpoint);
      return undefined;
    }

    const nameStart = cursor.position();
    cursor.advance(1);
    while (isTagNameChar(cursor.peek())) {
      cursor.advance(1);
    }

    const tag = cursor.slice(nameStart, cursor.position()).toLowerCase();
    if (cursor.eof() && (isCustomElementTag(tag) || isCustomElementTag(`${tag}x-x`))) {
      cursor.restore(checkpoint);
      return 'incomplete';
    }
    if (!isCustomElementTag(tag)) {
      cursor.restore(checkpoint);
      return undefined;
    }

    if (isClose) {
      this.skipWhitespace(cursor);
      if (cursor.peek() !== TAG_CLOSE) {
        const incomplete = cursor.eof();
        cursor.restore(checkpoint);
        return incomplete ? 'incomplete' : undefined;
      }
      const end = cursor.position() + 1;
      cursor.advance(1);
      return {
        token: { kind: 'element-close', tag, start: checkpoint, end },
        diagnostics: [],
      };
    }

    const attrDiagnostics: Diagnostic[] = [];
    const attrs = this.scanAttrs(cursor, attrDiagnostics);
    if (attrs === undefined) {
      const incomplete = cursor.eof();
      cursor.restore(checkpoint);
      return incomplete ? 'incomplete' : undefined;
    }

    this.skipWhitespace(cursor);

    let selfClosing = false;
    if (cursor.peek() === SLASH) {
      selfClosing = true;
      cursor.advance(1);
      this.skipWhitespace(cursor);
    }

    if (cursor.peek() !== TAG_CLOSE) {
      const incomplete = cursor.eof();
      cursor.restore(checkpoint);
      return incomplete ? 'incomplete' : undefined;
    }
    const end = cursor.position() + 1;
    cursor.advance(1);

    return {
      token: { kind: 'element-open', tag, attrs, selfClosing, start: checkpoint, end },
      diagnostics: attrDiagnostics,
    };
  }

  /**
   * Walks `name="value"` pairs (and boolean attributes) until it hits `>` or
   * `/`. Accepts single-quoted values with a warning diagnostic. Reports
   * `on*` attribute names as errors. Values are entity-decoded here, which
   * makes this the inverse of the escaping a serializer applies on the way
   * out. Returns undefined if the input is malformed (unterminated quote,
   * unexpected EOF) so `scanTag` can roll the cursor back.
   */
  private scanAttrs(
    cursor: Cursor,
    diagnostics: Diagnostic[],
  ): Readonly<Record<string, string>> | undefined {
    const attrs: Record<string, string> = {};

    while (true) {
      this.skipWhitespace(cursor);

      const peek = cursor.peek();
      if (peek === TAG_CLOSE || peek === SLASH) {
        return attrs;
      }
      if (peek === undefined) {
        return undefined;
      }

      if (!isAttrNameStart(peek)) {
        return undefined;
      }

      const nameStart = cursor.position();
      cursor.advance(1);
      while (isAttrNameChar(cursor.peek())) {
        cursor.advance(1);
      }
      const name = cursor.slice(nameStart, cursor.position()).toLowerCase();

      if (name.startsWith('on')) {
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          code: DiagnosticCode.ForbiddenAttribute,
          message: `forbidden event-handler attribute "${name}"`,
          start: nameStart,
          end: cursor.position(),
        });
      }

      this.skipWhitespace(cursor);

      if (cursor.peek() !== EQUALS) {
        attrs[name] = '';
        continue;
      }
      cursor.advance(1);
      this.skipWhitespace(cursor);

      const quote = cursor.peek();
      if (quote !== DOUBLE_QUOTE && quote !== SINGLE_QUOTE) {
        return undefined;
      }
      if (quote === SINGLE_QUOTE) {
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          code: DiagnosticCode.SingleQuotedAttribute,
          message: `attribute "${name}" uses single quotes — .htmd attributes should be double-quoted`,
          start: cursor.position(),
          end: cursor.position() + 1,
        });
      }
      cursor.advance(1);

      const valueStart = cursor.position();
      while (!cursor.eof() && cursor.peek() !== quote) {
        cursor.advance(1);
      }
      if (cursor.peek() !== quote) {
        return undefined;
      }
      const valueEnd = cursor.position();
      cursor.advance(1);

      // Decode once before consumers or security diagnostics inspect the value.
      const value = decodeEntities(cursor.slice(valueStart, valueEnd));
      if (value.toLowerCase().includes(JAVASCRIPT_SCHEME)) {
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          code: DiagnosticCode.ForbiddenUrlScheme,
          message: `attribute "${name}" carries a forbidden "javascript:" URL`,
          start: valueStart,
          end: valueEnd,
        });
      }

      attrs[name] = value;
    }
  }

  private skipWhitespace(cursor: Cursor): void {
    while (isWhitespace(cursor.peek())) {
      cursor.advance(1);
    }
  }
}

/**
 * Finds the next run of exactly `runLength` backticks at or after `from`,
 * stopping at a blank line or EOF. Returns the index of the run's first
 * backtick, or undefined.
 */
function findBacktickRun(source: string, from: number, runLength: number): number | undefined {
  let index = from;

  while (index < source.length) {
    const char = source[index];

    if (char === BACKTICK) {
      let length = 0;
      while (source[index + length] === BACKTICK) {
        length += 1;
      }
      if (length === runLength) {
        return index;
      }
      index += length;
      continue;
    }

    if (char === NEWLINE && isBlankLineAhead(source, index + 1)) {
      return undefined;
    }

    index += 1;
  }

  return undefined;
}

function isBlankLineAhead(source: string, from: number): boolean {
  let index = from;
  while (index < source.length) {
    const char = source[index];
    if (char === NEWLINE) {
      return true;
    }
    if (char !== ' ' && char !== '\t' && char !== '\r') {
      return false;
    }
    index += 1;
  }
  return true;
}
