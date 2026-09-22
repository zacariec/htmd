import { TokenCursor } from './token-cursor.js';
import { Tokenizer } from './tokenizer.js';
import type { ElementOpenToken } from './tokenizer.js';
import { DiagnosticCode, DiagnosticSeverity } from './types.js';
import type {
  Diagnostic,
  ElementBlock,
  HtmdDocument,
  HtmdNode,
  MarkdownBlock,
  ParseOptions,
  ParseResult,
} from './types.js';

interface ParseState {
  readonly streaming: boolean;
  pending: boolean;
}

/**
 * Parse a `.htmd` source string into a typed AST.
 *
 * - Markdown spans are emitted verbatim as `MarkdownBlock` nodes; consumers
 *   render them with a markdown renderer that keeps raw HTML disabled.
 * - Custom-element tags are parsed into `ElementBlock` nodes with attributes
 *   and recursively-parsed children.
 * - Plain HTML tags (no hyphen) are not recognised by the tokenizer; they
 *   remain inside markdown spans. Forbidden constructs (`<script>`, `on*=`
 *   attributes, `javascript:` URLs) surface as error diagnostics.
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

  public parse(source: string, options: ParseOptions = {}): ParseResult {
    const tokenized = Tokenizer.getInstance().tokenize(source, options);
    const cursor = new TokenCursor(tokenized.tokens);
    const diagnostics: Diagnostic[] = [...tokenized.diagnostics];
    const state: ParseState = {
      streaming: options.streaming === true,
      pending: tokenized.pending,
    };
    const nodes = this.parseNodes(source, cursor, undefined, diagnostics, state);

    return {
      document: { nodes, source },
      diagnostics,
      pending: state.pending,
    };
  }

  public emptyDocument(): HtmdDocument {
    return { nodes: [], source: '' };
  }

  private parseNodes(
    source: string,
    cursor: TokenCursor,
    closingTag: string | undefined,
    diagnostics: Diagnostic[],
    state: ParseState,
  ): readonly HtmdNode[] {
    const nodes: HtmdNode[] = [];

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
          severity: DiagnosticSeverity.Warning,
          code: DiagnosticCode.UnexpectedClosingTag,
          message: `unexpected closing tag </${token.tag}>`,
          start: token.start,
          end: token.end,
        });
        nodes.push({
          type: 'markdown',
          source: source.slice(token.start, token.end),
          start: token.start,
          end: token.end,
        });
        cursor.advance();
        continue;
      }

      cursor.advance();
      nodes.push(this.buildElementNode(source, token, cursor, diagnostics, state));
    }

    if (closingTag !== undefined) {
      if (state.streaming) {
        state.pending = true;
        return nodes;
      }
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        code: DiagnosticCode.MissingClosingTag,
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
    state: ParseState,
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

    const children = this.parseNodes(source, cursor, openToken.tag, diagnostics, state);
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
