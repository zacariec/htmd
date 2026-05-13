import { TokenCursor } from './token-cursor.js';
import { Tokenizer } from './tokenizer.js';
import type { ElementOpenToken } from './tokenizer.js';
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
 *
 * Singleton: `Parser` holds no per-source state. Each call to `parse(source)`
 * constructs a fresh `TokenCursor` and walks it.
 */
export class Parser {
  private static instance: Parser | undefined;

  private constructor() {}

  public static getInstance(): Parser {
    if (Parser.instance === undefined) {
      Parser.instance = new Parser();
    }
    return Parser.instance;
  }

  public parse(source: string): ParseResult {
    const tokens = Tokenizer.getInstance().tokenize(source);
    const cursor = new TokenCursor(tokens);
    const diagnostics: Diagnostic[] = [];
    const nodes = this.parseNodes(source, cursor, undefined, diagnostics);

    return {
      document: { nodes, source },
      diagnostics,
    };
  }

  public emptyDocument(): Document {
    return { nodes: [], source: '' };
  }

  private parseNodes(
    source: string,
    cursor: TokenCursor,
    closingTag: string | undefined,
    diagnostics: Diagnostic[],
  ): readonly Node[] {
    const nodes: Node[] = [];

    while (!cursor.eof()) {
      const token = cursor.peek();
      if (token === undefined) {
        break;
      }

      if (token.kind === 'markdown') {
        cursor.advance();
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
          cursor.advance();
          return nodes;
        }
        diagnostics.push({
          severity: 'warning',
          message: `unexpected closing tag </${token.tag}>`,
          start: token.start,
          end: token.end,
        });
        cursor.advance();
        continue;
      }

      cursor.advance();
      nodes.push(this.buildElementNode(source, token, cursor, diagnostics));
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

  private buildElementNode(
    source: string,
    openToken: ElementOpenToken,
    cursor: TokenCursor,
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

    const children = this.parseNodes(source, cursor, openToken.tag, diagnostics);
    const closingEnd = cursor.lastConsumedEnd();

    return {
      type: 'element',
      tag: openToken.tag,
      attrs: openToken.attrs,
      children,
      selfClosing: false,
      source: source.slice(openToken.start, closingEnd),
      start: openToken.start,
      end: closingEnd,
    };
  }
}
