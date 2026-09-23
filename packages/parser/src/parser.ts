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
  readonly maxDepth: number;
  pending: boolean;
}

const DEFAULT_MAX_DEPTH = 64;

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
 * - Unmatched closing tags and tags nested deeper than `maxDepth` stay
 *   literal text, merged into the surrounding markdown span. The depth bound
 *   also bounds recursion here and in every consumer that walks the tree.
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
      maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
      pending: tokenized.pending,
    };
    const { nodes } = this.parseNodes(source, cursor, undefined, 0, diagnostics, state);

    return {
      document: { nodes, source },
      diagnostics,
      pending: state.pending,
    };
  }

  public emptyDocument(): HtmdDocument {
    return { nodes: [], source: '' };
  }

  /**
   * Parses siblings until `closingTag` (or EOF). `depth` counts the enclosing
   * elements. Markdown and literal tag text accumulate into one contiguous
   * span, flushed when an element node or the end of the siblings is reached.
   * Closing tags of openings left literal for depth close them as text.
   */
  private parseNodes(
    source: string,
    cursor: TokenCursor,
    closingTag: string | undefined,
    depth: number,
    diagnostics: Diagnostic[],
    state: ParseState,
  ): { readonly nodes: readonly HtmdNode[]; readonly closed: boolean } {
    const nodes: HtmdNode[] = [];
    let textStart = -1;
    let textEnd = -1;
    let reportedTooDeep = false;
    const literalTags: string[] = [];
    const appendText = (start: number, end: number): void => {
      if (start === end) {
        return;
      }
      if (textStart !== -1 && textEnd === start) {
        textEnd = end;
        return;
      }
      flushText();
      textStart = start;
      textEnd = end;
    };
    const flushText = (): void => {
      if (textStart === -1) {
        return;
      }
      const block: MarkdownBlock = {
        type: 'markdown',
        source: source.slice(textStart, textEnd),
        start: textStart,
        end: textEnd,
      };
      nodes.push(block);
      textStart = -1;
    };

    while (!cursor.eof()) {
      const token = cursor.peek();
      if (token === undefined) {
        break;
      }
      cursor.advance();

      if (token.kind === 'markdown') {
        appendText(token.start, token.end);
        continue;
      }

      if (token.kind === 'element-close') {
        if (literalTags.at(-1) === token.tag) {
          literalTags.pop();
          appendText(token.start, token.end);
          continue;
        }
        if (closingTag !== undefined && token.tag === closingTag) {
          flushText();
          return { nodes, closed: true };
        }
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          code: DiagnosticCode.UnexpectedClosingTag,
          message: `unexpected closing tag </${token.tag}>`,
          start: token.start,
          end: token.end,
        });
        appendText(token.start, token.end);
        continue;
      }

      if (depth >= state.maxDepth) {
        // One report per parent: a flood of deep openings stays one diagnostic.
        if (!reportedTooDeep) {
          reportedTooDeep = true;
          diagnostics.push({
            severity: DiagnosticSeverity.Error,
            code: DiagnosticCode.NestingTooDeep,
            message: `custom elements nest deeper than ${state.maxDepth} levels; <${token.tag}> is left as text`,
            start: token.start,
            end: token.end,
          });
        }
        if (!token.selfClosing) {
          literalTags.push(token.tag);
        }
        appendText(token.start, token.end);
        continue;
      }

      flushText();
      nodes.push(this.buildElementNode(source, token, cursor, depth + 1, diagnostics, state));
    }
    flushText();

    if (closingTag !== undefined) {
      if (state.streaming) {
        state.pending = true;
        return { nodes, closed: false };
      }
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        code: DiagnosticCode.MissingClosingTag,
        message: `missing closing tag </${closingTag}>`,
        start: source.length,
        end: source.length,
      });
    }

    return { nodes, closed: false };
  }

  private buildElementNode(
    source: string,
    openToken: ElementOpenToken,
    cursor: TokenCursor,
    depth: number,
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
        complete: true,
        source: source.slice(openToken.start, openToken.end),
        start: openToken.start,
        end: openToken.end,
      };
    }

    const { nodes: children, closed } = this.parseNodes(
      source,
      cursor,
      openToken.tag,
      depth,
      diagnostics,
      state,
    );
    const closingEnd = cursor.lastConsumedEnd();

    return {
      type: 'element',
      tag: openToken.tag,
      attrs: openToken.attrs,
      children,
      selfClosing: false,
      complete: closed,
      source: source.slice(openToken.start, closingEnd),
      start: openToken.start,
      end: closingEnd,
    };
  }
}
