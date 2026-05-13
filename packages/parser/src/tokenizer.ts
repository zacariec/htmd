import {
  isAttrNameChar,
  isAttrNameStart,
  isTagNameChar,
  isTagNameStart,
  isWhitespace,
} from './char-predicates.js';
import { Cursor } from './cursor.js';
import { isCustomElementTag } from './is-custom-element-tag.js';

/**
 * Tokenizer — finds top-level custom-element openings in `.htmd` source.
 *
 * Intentionally a flat scan, not a full HTML parser. It locates custom-element
 * regions and emits everything else as markdown tokens for the consumer's
 * markdown renderer.
 *
 * Code fences (```) and inline code (`) suppress tokenizing so a custom-element
 * literal inside a code block stays markdown.
 *
 * The tokenizer walks one character at a time via the `Cursor` class. No
 * regular expressions are used.
 *
 * Singleton: a `Tokenizer` instance holds no per-source state — each call to
 * `tokenize(source)` constructs its own `Cursor`. The singleton avoids the
 * cost (and noise) of `new Tokenizer()` at every call site.
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

const FENCE_MARKER = '```';
const INLINE_CODE_MARKER = '`';
const TAG_OPEN = '<';
const TAG_CLOSE = '>';
const SLASH = '/';
const QUOTE = '"';
const EQUALS = '=';

export class Tokenizer {
  private static instance: Tokenizer | undefined;

  private constructor() {}

  public static getInstance(): Tokenizer {
    if (Tokenizer.instance === undefined) {
      Tokenizer.instance = new Tokenizer();
    }
    return Tokenizer.instance;
  }

  public tokenize(source: string): readonly Token[] {
    const cursor = new Cursor(source);
    const tokens: Token[] = [];
    let markdownStart = 0;
    let inFence = false;
    let inInlineCode = false;

    while (!cursor.eof()) {
      if (!inFence && !inInlineCode && cursor.startsWith(FENCE_MARKER)) {
        inFence = true;
        cursor.advance(FENCE_MARKER.length);
        continue;
      }

      if (inFence && cursor.startsWith(FENCE_MARKER)) {
        inFence = false;
        cursor.advance(FENCE_MARKER.length);
        continue;
      }

      if (!inFence && cursor.peek() === INLINE_CODE_MARKER) {
        inInlineCode = !inInlineCode;
        cursor.advance(1);
        continue;
      }

      if (inFence || inInlineCode) {
        cursor.advance(1);
        continue;
      }

      if (cursor.peek() !== TAG_OPEN) {
        cursor.advance(1);
        continue;
      }

      const tagStart = cursor.position();
      const tagToken = this.scanTag(cursor);
      if (tagToken === undefined) {
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

      tokens.push(tagToken);
      markdownStart = cursor.position();
    }

    if (cursor.position() > markdownStart) {
      tokens.push({
        kind: 'markdown',
        value: cursor.slice(markdownStart, cursor.position()),
        start: markdownStart,
        end: cursor.position(),
      });
    }

    return tokens;
  }

  /**
   * Attempts to scan a custom-element open or close tag at the current
   * cursor position. Returns the token and leaves the cursor positioned
   * after `>`, or returns undefined and restores the cursor to its
   * original position.
   */
  private scanTag(cursor: Cursor): ElementOpenToken | ElementCloseToken | undefined {
    const checkpoint = cursor.save();

    if (cursor.peek() !== TAG_OPEN) {
      return undefined;
    }
    cursor.advance(1);

    const isClose = cursor.peek() === SLASH;
    if (isClose) {
      cursor.advance(1);
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
    if (!isCustomElementTag(tag)) {
      cursor.restore(checkpoint);
      return undefined;
    }

    if (isClose) {
      this.skipWhitespace(cursor);
      if (cursor.peek() !== TAG_CLOSE) {
        cursor.restore(checkpoint);
        return undefined;
      }
      const end = cursor.position() + 1;
      cursor.advance(1);
      return { kind: 'element-close', tag, start: checkpoint, end };
    }

    const attrs = this.scanAttrs(cursor);
    if (attrs === undefined) {
      cursor.restore(checkpoint);
      return undefined;
    }

    this.skipWhitespace(cursor);

    let selfClosing = false;
    if (cursor.peek() === SLASH) {
      selfClosing = true;
      cursor.advance(1);
      this.skipWhitespace(cursor);
    }

    if (cursor.peek() !== TAG_CLOSE) {
      cursor.restore(checkpoint);
      return undefined;
    }
    const end = cursor.position() + 1;
    cursor.advance(1);

    return {
      kind: 'element-open',
      tag,
      attrs,
      selfClosing,
      start: checkpoint,
      end,
    };
  }

  /**
   * Walks `name="value"` pairs (and boolean attributes) until it hits `>`
   * or `/`. Returns undefined if the input is malformed (unterminated
   * quote, unexpected EOF, etc.) so `scanTag` can roll the cursor back.
   */
  private scanAttrs(cursor: Cursor): Readonly<Record<string, string>> | undefined {
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

      this.skipWhitespace(cursor);

      if (cursor.peek() !== EQUALS) {
        attrs[name] = '';
        continue;
      }
      cursor.advance(1);
      this.skipWhitespace(cursor);

      if (cursor.peek() !== QUOTE) {
        return undefined;
      }
      cursor.advance(1);

      const valueStart = cursor.position();
      while (!cursor.eof() && cursor.peek() !== QUOTE) {
        cursor.advance(1);
      }
      if (cursor.peek() !== QUOTE) {
        return undefined;
      }
      const value = cursor.slice(valueStart, cursor.position());
      cursor.advance(1);

      attrs[name] = value;
    }
  }

  private skipWhitespace(cursor: Cursor): void {
    while (isWhitespace(cursor.peek())) {
      cursor.advance(1);
    }
  }
}
