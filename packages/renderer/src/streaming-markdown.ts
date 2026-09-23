/**
 * Provisional Markdown for the unfinished end ("frontier") of a stream.
 *
 * Only the frontier can be incomplete: blocks before a blank line, a closed
 * fence, or a later component are finished. While streaming, the frontier is
 * adjusted before rendering so readers never see syntax that later vanishes:
 *
 * - Complete what is unambiguous: open emphasis, strong, strikethrough, and
 *   inline code are closed at the end of the text.
 * - Withhold what is ambiguous: a last line holding only block markers
 *   (`-`, `1.`, `>`, `#`, `|`, backticks, …), a table header whose delimiter
 *   row has not arrived, a partial closing fence inside a code block.
 * - Never make partial things interactive: a link whose destination is still
 *   streaming shows its label as text; a partial image or angle autolink is
 *   withheld; a trailing bare URL or email streams as escaped text and links
 *   once whitespace completes it.
 *
 * Finalization never uses this: completed sources render with ordinary
 * CommonMark + GFM semantics.
 */

export interface ProvisionalMarkdown {
  /** Markdown to render for the current prefix. */
  readonly source: string;
  /** True when the frontier was completed or withheld. */
  readonly provisional: boolean;
}

interface FenceScan {
  /** The fence still open at the end of the source. */
  readonly open:
    | { readonly char: string; readonly length: number; readonly line: number }
    | undefined;
  /** Offset just after the last line that closed a fence. */
  readonly afterLastClose: number;
}

const FENCE_OPEN = /^[ \t]{0,3}(`{3,}|~{3,})(.*)$/;
const BLOCK_START = /^[ \t]*(?:[-+*][ \t]|\d{1,9}[.)][ \t]|#{1,6}[ \t]|>|\|)/;
const DELIMITER_PREFIX = /^[\s|:-]*$/;
/** Angle autolinks hide their `<`, so a partial one is withheld. */
const TRAILING_ANGLE_AUTOLINK = /<(?:[A-Za-z][^\s>`]*)?$/;
/**
 * GFM literal autolinks (after whitespace or `(*_~`) link as soon as they
 * look complete, so a trailing one is escaped: the text keeps streaming, and
 * the link appears once whitespace ends it.
 */
const TRAILING_LITERAL_AUTOLINK =
  /(?:^|(?<=[\s(*_~]))(?:(https?)(:\/\/)[^\s<`]*|(www)(\.)[^\s<`]*|[\w.+-]+(@)[\w.-]*)$/i;
const MARKER_ONLY = /^[\s\-+*#=_`~|:.)\d>]*$/;
const TASK_START = /^\[[ xX]?\]?[ \t]*$/;
const LIST_MARKER = /^(?:[-+*]|\d{1,9}[.)])(?:[ \t]+|$)/;
const DELIMITER_ROW = /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const WORD = /[\p{L}\p{N}]/u;
const PUNCTUATION = /[\p{P}\p{S}]/u;
const WHITESPACE = /\s/;

export function provisionalMarkdown(source: string): ProvisionalMarkdown {
  const fences = scanFences(source);
  const repaired =
    fences.open === undefined
      ? completeInline(withholdAmbiguousLines(source), fences.afterLastClose)
      : withholdPartialFenceClose(source, fences.open);
  return { source: repaired, provisional: repaired !== source };
}

function scanFences(source: string): FenceScan {
  let open: FenceScan['open'];
  let afterLastClose = 0;
  let offset = 0;
  const lines = source.split('\n');
  for (const [index, line] of lines.entries()) {
    const lineEnd = offset + line.length + 1;
    if (open === undefined) {
      const match = FENCE_OPEN.exec(line);
      const run = match?.[1];
      if (run !== undefined && !(run.startsWith('`') && match?.[2]?.includes('`') === true)) {
        open = { char: run.charAt(0), length: run.length, line: index };
      }
    } else {
      const trimmed = line.trim();
      if (
        line.length - line.trimStart().length <= 3 &&
        trimmed.length >= open.length &&
        [...trimmed].every((char) => char === open?.char)
      ) {
        open = undefined;
        afterLastClose = Math.min(lineEnd, source.length);
      }
    }
    offset = lineEnd;
  }
  return { open, afterLastClose };
}

/** Inside an open fence, a last line of fewer fence characters is a closing fence arriving. */
function withholdPartialFenceClose(source: string, fence: NonNullable<FenceScan['open']>): string {
  const lastLineStart = source.lastIndexOf('\n') + 1;
  if (lastLineStart === 0 || source.slice(0, lastLineStart).split('\n').length - 1 <= fence.line) {
    return source;
  }
  const last = source.slice(lastLineStart);
  const trimmed = last.trim();
  const partialClose =
    last.length - last.trimStart().length <= 3 &&
    trimmed.length > 0 &&
    trimmed.length < fence.length &&
    [...trimmed].every((char) => char === fence.char);
  return partialClose ? source.slice(0, lastLineStart) : source;
}

function withholdAmbiguousLines(source: string): string {
  const lastLineStart = source.lastIndexOf('\n') + 1;
  const trimmedSource = markerOnly(source.slice(lastLineStart))
    ? source.slice(0, lastLineStart)
    : source;
  return withholdUnconfirmedTable(trimmedSource);
}

/** A line that is only block markers could still become a list, heading, fence, rule, or table. */
function markerOnly(line: string): boolean {
  let rest = line.replace(/^[ \t]*(?:>[ \t]?)*/, '');
  const list = LIST_MARKER.exec(rest);
  if (list !== null) {
    rest = rest.slice(list[0].length);
    if (TASK_START.test(rest)) {
      return true;
    }
  }
  return MARKER_ONLY.test(rest);
}

/**
 * A pipe row is a table header only once a matching delimiter row arrives.
 * Until then the header (and any partial delimiter row) is withheld.
 */
function withholdUnconfirmedTable(source: string): string {
  const lines = source.split('\n');
  const last = lines.length - 1;
  for (const header of [last - 1, last]) {
    const line = lines[header];
    if (line === undefined || !line.includes('|')) {
      continue;
    }
    // A pipe line after another pipe line is a row of an established table.
    if (lines[header - 1]?.includes('|') === true) {
      continue;
    }
    const delimiter = lines[header + 1];
    if (delimiter !== undefined) {
      const terminated = header + 1 < last;
      const confirmed =
        DELIMITER_ROW.test(delimiter) &&
        cellCount(delimiter) === cellCount(line) &&
        (terminated || delimiter.trimEnd().endsWith('|'));
      if (confirmed || terminated || !DELIMITER_PREFIX.test(delimiter)) {
        continue;
      }
    }
    return lines.slice(0, header).join('\n') + (header > 0 ? '\n' : '');
  }
  return source;
}

function cellCount(row: string): number {
  const inner = row
    .trim()
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '');
  return inner.split(/(?<!\\)\|/).length;
}

/**
 * Completes or withholds inline constructs in the current block: the text
 * after the last blank line, closed fence, or block-starting line.
 */
function completeInline(source: string, afterLastClose: number): string {
  let tailStart = Math.max(afterLastClose, blankLineEnd(source));
  const lines = source.slice(tailStart).split('\n');
  let offset = tailStart;
  for (const line of lines) {
    if (BLOCK_START.test(line)) {
      tailStart = offset;
    }
    offset += line.length + 1;
  }
  const tail = source.slice(tailStart);
  const body = tail.trimEnd();
  const whitespace = tail.slice(body.length);
  const completed = completeInlineText(body);
  return completed === body ? source : source.slice(0, tailStart) + completed + whitespace;
}

function blankLineEnd(source: string): number {
  const pattern = /\n[ \t]*\n/g;
  let end = 0;
  for (let match = pattern.exec(source); match !== null; match = pattern.exec(source)) {
    end = match.index + match[0].length;
  }
  return end;
}

function completeInlineText(body: string): string {
  const code = unmatchedCodeRun(body);
  const before = code === undefined ? body : body.slice(0, code.start);
  let text = repairLinks(before);
  const linkWithheld = text !== before;
  if (code === undefined) {
    const angle = TRAILING_ANGLE_AUTOLINK.exec(text);
    if (angle !== null && !insideProtectedSpan(text, angle.index)) {
      text = text.slice(0, angle.index);
    }
    const literal = TRAILING_LITERAL_AUTOLINK.exec(text);
    if (literal !== null && !insideProtectedSpan(text, literal.index)) {
      const escapeAt =
        literal.index +
        (literal[1]?.length ?? (literal[3] !== undefined ? 3 : literal[0].indexOf('@')));
      text = `${text.slice(0, escapeAt)}\\${text.slice(escapeAt)}`;
    }
    // A trailing `!` may start an image.
    if (text.endsWith('!') && !text.endsWith('\\!')) {
      text = text.slice(0, -1);
    }
  }

  let codePart = '';
  if (code !== undefined && !linkWithheld) {
    const content = body
      .slice(code.start + code.length)
      .replace(/`+$/, (run) => (run.length < code.length ? '' : run));
    if (content.trim().length > 0) {
      codePart =
        body.slice(code.start, code.start + code.length) + content + '`'.repeat(code.length);
    }
  }

  const emphasis = closeEmphasis(text, codePart.length > 0);
  return emphasis.text + codePart + emphasis.closers;
}

interface CodeRun {
  readonly start: number;
  readonly length: number;
}

/** First backtick run without a matching closing run: an inline code span still streaming. */
function unmatchedCodeRun(text: string): CodeRun | undefined {
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === '\\') {
      index += 2;
      continue;
    }
    if (char !== '`') {
      index += 1;
      continue;
    }
    const length = runLength(text, index, '`');
    const close = findRun(text, index + length, '`', length);
    if (close === undefined) {
      return { start: index, length };
    }
    index = close + length;
  }
  return undefined;
}

function runLength(text: string, start: number, char: string): number {
  let end = start;
  while (text[end] === char) {
    end += 1;
  }
  return end - start;
}

/** Start of the next run of exactly `length` `char`s at or after `from`. */
function findRun(text: string, from: number, char: string, length: number): number | undefined {
  let index = from;
  while (index < text.length) {
    if (text[index] !== char) {
      index += 1;
      continue;
    }
    const run = runLength(text, index, char);
    if (run === length) {
      return index;
    }
    index += run;
  }
  return undefined;
}

/** True when `position` lies inside a complete code span or inline link destination. */
function insideProtectedSpan(text: string, position: number): boolean {
  let index = 0;
  while (index < position) {
    const char = text[index];
    if (char === '\\') {
      index += 2;
      continue;
    }
    let end: number | undefined;
    if (char === '`') {
      const length = runLength(text, index, '`');
      const close = findRun(text, index + length, '`', length);
      end = close === undefined ? undefined : close + length;
    } else if (char === ']' && text[index + 1] === '(') {
      const close = matchingParen(text, index + 1);
      end = close === undefined ? undefined : close + 1;
    }
    if (end === undefined) {
      index += 1;
    } else if (position < end) {
      return true;
    } else {
      index = end;
    }
  }
  return false;
}

/**
 * A link whose destination is still streaming shows its label; an image or
 * an unclosed `[` label at the frontier is withheld or shown as text.
 */
function repairLinks(text: string): string {
  const open: { readonly index: number; readonly image: boolean }[] = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === '\\') {
      index += 2;
      continue;
    }
    if (char === '`') {
      const length = runLength(text, index, '`');
      const close = findRun(text, index + length, '`', length);
      index = close === undefined ? index + length : close + length;
      continue;
    }
    if (char === '[') {
      open.push({ index, image: index > 0 && text[index - 1] === '!' });
      index += 1;
      continue;
    }
    if (char !== ']' || open.length === 0) {
      index += 1;
      continue;
    }
    const label = open.pop();
    if (label === undefined) {
      break;
    }
    const after = index + 1;
    if (text[after] === '(') {
      const close = matchingParen(text, after);
      if (close !== undefined) {
        open.length = 0;
        index = close + 1;
        continue;
      }
      return frontierLink(text, label, index);
    }
    if (after === text.length) {
      return text.slice(0, label.image ? label.index - 1 : label.index);
    }
    index = after;
  }

  // An unmatched `[` may be a link, a citation, or literal text: withhold it until it resolves.
  const first = open[0];
  return first === undefined ? text : text.slice(0, first.image ? first.index - 1 : first.index);
}

function frontierLink(
  text: string,
  label: { readonly index: number; readonly image: boolean },
  labelEnd: number,
): string {
  if (label.image) {
    return text.slice(0, label.index - 1);
  }
  return repairLinks(text.slice(0, label.index) + text.slice(label.index + 1, labelEnd));
}

function matchingParen(text: string, open: number): number | undefined {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (char === '\\') {
      index += 1;
    } else if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return undefined;
}

interface Opener {
  readonly char: string;
  remaining: number;
  readonly intraword: boolean;
}

/**
 * Closes open emphasis, strong, and strikethrough delimiters using CommonMark
 * flanking rules. Intraword openers (`2*3`) are left literal; a delimiter run
 * at the very end that closes nothing is withheld.
 */
function closeEmphasis(
  text: string,
  followedByContent: boolean,
): { readonly text: string; readonly closers: string } {
  const stack: Opener[] = [];
  let withheldFrom: number | undefined;
  let index = 0;
  while (index < text.length) {
    const char = text[index] ?? '';
    if (char === '\\') {
      index += 2;
      continue;
    }
    if (char === '`') {
      const length = runLength(text, index, '`');
      const close = findRun(text, index + length, '`', length);
      index = close === undefined ? index + length : close + length;
      continue;
    }
    if (char === ']' && text[index + 1] === '(') {
      index = (matchingParen(text, index + 1) ?? text.length - 1) + 1;
      continue;
    }
    if (char !== '*' && char !== '_' && char !== '~') {
      index += 1;
      continue;
    }

    const length = runLength(text, index, char);
    const end = index + length;
    const prev = index > 0 ? (text[index - 1] ?? '\n') : '\n';
    const atEnd = end === text.length && !followedByContent;
    const next = atEnd ? ' ' : (text[end] ?? ' ');
    const prevSpace = WHITESPACE.test(prev);
    const nextSpace = WHITESPACE.test(next);
    const prevPunct = PUNCTUATION.test(prev);
    const nextPunct = PUNCTUATION.test(next);
    const left = !nextSpace && (!nextPunct || prevSpace || prevPunct);
    const right = !prevSpace && (!prevPunct || nextSpace || nextPunct);
    const canOpen = char === '_' ? left && (!right || prevPunct) : left;
    const canClose = char === '_' ? right && (!left || nextPunct) : right;

    let remaining = length;
    if (canClose) {
      for (let k = stack.length - 1; k >= 0; k -= 1) {
        const opener = stack[k];
        if (opener === undefined || opener.char !== char) {
          continue;
        }
        const matched = Math.min(opener.remaining, remaining);
        opener.remaining -= matched;
        remaining -= matched;
        stack.length = opener.remaining > 0 ? k + 1 : k;
        break;
      }
    }
    if (remaining > 0) {
      if (canOpen) {
        stack.push({ char, remaining, intraword: WORD.test(prev) });
      } else if (atEnd) {
        withheldFrom = end - remaining;
      }
    }
    index = end;
  }

  let kept = withheldFrom === undefined ? text : text.slice(0, withheldFrom);
  const closers = stack
    .filter((opener) => !opener.intraword)
    .reverse()
    .map((opener) => opener.char.repeat(opener.remaining))
    .join('');
  if (closers.length > 0 && !followedByContent) {
    kept = kept.trimEnd();
  }
  return { text: kept, closers };
}
