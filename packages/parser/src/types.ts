/**
 * `.htmd` AST types.
 *
 * A document is a flat list of top-level blocks. Each block is either a run of
 * markdown prose (parsed lazily by the consumer's chosen markdown renderer) or
 * a custom-element node.
 *
 * The parser does NOT walk inside markdown blocks. It only locates custom
 * elements and slices the document accordingly. The consumer renders markdown
 * blocks with a markdown renderer that keeps raw HTML disabled.
 */

export type HtmdNode = MarkdownBlock | ElementBlock;

export interface MarkdownBlock {
  readonly type: 'markdown';
  readonly source: string;
  readonly start: number;
  readonly end: number;
}

export interface ElementBlock {
  readonly type: 'element';
  readonly tag: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: ReadonlyArray<HtmdNode>;
  readonly selfClosing: boolean;
  readonly source: string;
  readonly start: number;
  readonly end: number;
}

export interface HtmdDocument {
  readonly nodes: ReadonlyArray<HtmdNode>;
  readonly source: string;
}

export enum DiagnosticCode {
  UnexpectedClosingTag = 'unexpected-closing-tag',
  MissingClosingTag = 'missing-closing-tag',
  IncompleteTag = 'incomplete-tag',
  ForbiddenTag = 'forbidden-tag',
  ForbiddenAttribute = 'forbidden-attribute',
  ForbiddenUrlScheme = 'forbidden-url-scheme',
  SingleQuotedAttribute = 'single-quoted-attribute',
}

export enum DiagnosticSeverity {
  Error = 'error',
  Warning = 'warning',
}

/**
 * Parser diagnostic. The parser collects diagnostics for forbidden constructs
 * (`<script>`, `on*=` handlers, `javascript:` URLs) and for structural issues
 * (unmatched tags). The consumer decides whether to reject the document or
 * render it with the offending constructs neutralised.
 */
export interface Diagnostic {
  readonly severity: DiagnosticSeverity;
  readonly code: DiagnosticCode;
  readonly message: string;
  readonly start: number;
  readonly end: number;
}

export interface ParseOptions {
  /** Buffer incomplete custom tags and allow open elements until finalization. */
  readonly streaming?: boolean;
}

export interface ParseResult {
  readonly document: HtmdDocument;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  /** Known incomplete syntax; false does not imply Markdown is no longer provisional. */
  readonly pending: boolean;
}
