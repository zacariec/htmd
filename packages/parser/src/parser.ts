import { tokenize } from './tokenizer.js';
import type { ElementOpenToken, Token } from './tokenizer.js';
import type {
  Diagnostic,
  Document,
  ElementBlock,
  MarkdownBlock,
  Node,
  ParseResult,
} from './types.js';

/**
 * Parse a `.htmd` source string into a typed AST.
 *
 * - Markdown spans are emitted verbatim as `MarkdownBlock` nodes; consumers
 *   render them with their chosen markdown library (marked / remark / etc.).
 * - Custom-element tags are parsed into `ElementBlock` nodes with attributes
 *   and recursively-parsed children.
 * - Plain HTML tags (no hyphen) are not recognised by the tokenizer; they
 *   remain inside markdown spans and the markdown layer escapes them.
 */
export function parse(source: string): ParseResult {
  const tokens = tokenize(source);
  const diagnostics: Diagnostic[] = [];
  const cursor = { index: 0 };

  const nodes = parseNodes(source, tokens, cursor, undefined, diagnostics);

  return {
    document: { nodes, source },
    diagnostics,
  };
}

function parseNodes(
  source: string,
  tokens: ReadonlyArray<Token>,
  cursor: { index: number },
  closingTag: string | undefined,
  diagnostics: Diagnostic[],
): ReadonlyArray<Node> {
  const nodes: Node[] = [];

  while (cursor.index < tokens.length) {
    const token = tokens[cursor.index];
    if (token === undefined) {
      break;
    }

    if (token.kind === 'markdown') {
      cursor.index += 1;
      if (token.value.length === 0) {
        continue;
      }
      const block: MarkdownBlock = {
        type: 'markdown',
        source: token.value,
        start: token.start,
        end: token.end,
      };
      nodes.push(block);
      continue;
    }

    if (token.kind === 'element-close') {
      if (closingTag !== undefined && token.tag === closingTag) {
        cursor.index += 1;
        return nodes;
      }
      diagnostics.push({
        severity: 'warning',
        message: `unexpected closing tag </${token.tag}>`,
        start: token.start,
        end: token.end,
      });
      cursor.index += 1;
      continue;
    }

    cursor.index += 1;
    nodes.push(buildElementNode(source, token, tokens, cursor, diagnostics));
  }

  if (closingTag !== undefined) {
    diagnostics.push({
      severity: 'warning',
      message: `missing closing tag </${closingTag}>`,
      start: source.length,
      end: source.length,
    });
  }

  return nodes;
}

function buildElementNode(
  source: string,
  openToken: ElementOpenToken,
  tokens: ReadonlyArray<Token>,
  cursor: { index: number },
  diagnostics: Diagnostic[],
): ElementBlock {
  if (openToken.selfClosing) {
    return {
      type: 'element',
      tag: openToken.tag,
      attrs: openToken.attrs,
      children: [],
      selfClosing: true,
      source: source.slice(openToken.start, openToken.end),
      start: openToken.start,
      end: openToken.end,
    };
  }

  const children = parseNodes(source, tokens, cursor, openToken.tag, diagnostics);
  const closingTokenEnd = closingEndForChildren(tokens, cursor.index);

  return {
    type: 'element',
    tag: openToken.tag,
    attrs: openToken.attrs,
    children,
    selfClosing: false,
    source: source.slice(openToken.start, closingTokenEnd),
    start: openToken.start,
    end: closingTokenEnd,
  };
}

function closingEndForChildren(tokens: ReadonlyArray<Token>, indexAfterClose: number): number {
  const prior = tokens[indexAfterClose - 1];
  if (prior === undefined) {
    return 0;
  }
  return prior.end;
}

export function emptyDocument(): Document {
  return { nodes: [], source: '' };
}
