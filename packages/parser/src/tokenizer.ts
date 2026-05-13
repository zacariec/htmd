import { isCustomElementTag } from './is-custom-element-tag.js';

/**
 * Tokenizer — finds top-level custom-element openings in a `.htmd` source
 * string. Yields tokens for the surrounding parser to assemble into nodes.
 *
 * This is intentionally a flat scan, not a full HTML parser. It locates
 * custom-element regions and delegates everything else to the markdown layer.
 *
 * Code fences (```) and inline code (`) suppress tokenizing, so a custom-element
 * literal inside a code block stays markdown.
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

const ATTR = /([a-z][a-z0-9-]*)\s*=\s*"([^"]*)"/gi;

export function tokenize(source: string): ReadonlyArray<Token> {
  const tokens: Token[] = [];

  let cursor = 0;
  let mdStart = 0;
  let inFence = false;
  let inInlineCode = false;

  const flushMarkdown = (end: number): void => {
    if (end <= mdStart) {
      return;
    }
    tokens.push({
      kind: 'markdown',
      value: source.slice(mdStart, end),
      start: mdStart,
      end,
    });
  };

  while (cursor < source.length) {
    if (!inFence && !inInlineCode && source.startsWith('```', cursor)) {
      inFence = true;
      cursor += 3;
      continue;
    }

    if (inFence && source.startsWith('```', cursor)) {
      inFence = false;
      cursor += 3;
      continue;
    }

    if (!inFence && source[cursor] === '`') {
      inInlineCode = !inInlineCode;
      cursor += 1;
      continue;
    }

    if (inFence || inInlineCode) {
      cursor += 1;
      continue;
    }

    if (source[cursor] !== '<') {
      cursor += 1;
      continue;
    }

    const tagMatch = matchTagAt(source, cursor);
    if (tagMatch === undefined) {
      cursor += 1;
      continue;
    }

    flushMarkdown(cursor);

    tokens.push(tagMatch.token);
    cursor = tagMatch.end;
    mdStart = cursor;
  }

  flushMarkdown(source.length);

  return tokens;
}

interface TagMatch {
  readonly token: ElementOpenToken | ElementCloseToken;
  readonly end: number;
}

function matchTagAt(source: string, start: number): TagMatch | undefined {
  if (source[start] !== '<') {
    return undefined;
  }

  const isClose = source[start + 1] === '/';
  const nameStart = isClose ? start + 2 : start + 1;
  const nameMatch = /^[a-z][a-z0-9-]*/i.exec(source.slice(nameStart));
  if (nameMatch === null) {
    return undefined;
  }

  const tag = nameMatch[0].toLowerCase();
  if (!isCustomElementTag(tag)) {
    return undefined;
  }

  const afterName = nameStart + nameMatch[0].length;
  const gtIndex = findUnquotedGt(source, afterName);
  if (gtIndex === undefined) {
    return undefined;
  }

  const inner = source.slice(afterName, gtIndex);
  const selfClosing = inner.trimEnd().endsWith('/');
  const attrSection = selfClosing ? inner.trimEnd().slice(0, -1) : inner;

  if (isClose) {
    return {
      token: {
        kind: 'element-close',
        tag,
        start,
        end: gtIndex + 1,
      },
      end: gtIndex + 1,
    };
  }

  const attrs: Record<string, string> = {};
  for (const match of attrSection.matchAll(ATTR)) {
    const [, name, value] = match;
    if (name !== undefined && value !== undefined) {
      attrs[name] = value;
    }
  }

  return {
    token: {
      kind: 'element-open',
      tag,
      attrs,
      selfClosing,
      start,
      end: gtIndex + 1,
    },
    end: gtIndex + 1,
  };
}

function findUnquotedGt(source: string, from: number): number | undefined {
  let inQuote = false;
  for (let i = from; i < source.length; i += 1) {
    const char = source[i];
    if (char === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (char === '>' && !inQuote) {
      return i;
    }
  }
  return undefined;
}
