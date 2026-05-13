/**
 * `.htmd` AST types.
 *
 * A document is a flat list of top-level blocks. Each block is either a run of
 * markdown prose (parsed lazily by the consumer's chosen markdown renderer) or
 * a custom-element node.
 *
 * The parser does NOT walk inside markdown blocks. It only locates custom
 * elements and slices the document accordingly. The consumer renders markdown
 * blocks with marked/remark/markdown-it/etc.
 */

export type Node = MarkdownBlock | ElementBlock;

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
  readonly children: ReadonlyArray<Node>;
  readonly selfClosing: boolean;
  readonly source: string;
  readonly start: number;
  readonly end: number;
}

export interface Document {
  readonly nodes: ReadonlyArray<Node>;
  readonly source: string;
}

/**
 * Parser diagnostic. The parser collects diagnostics for forbidden constructs
 * (plain HTML tags, `<script>`, `javascript:` URLs, etc.) and the consumer
 * decides whether to reject the document or strip the offending nodes.
 */
export interface Diagnostic {
  readonly severity: 'error' | 'warning';
  readonly message: string;
  readonly start: number;
  readonly end: number;
}

export interface ParseResult {
  readonly document: Document;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
}
