import { parse, postprocess, preprocess } from 'micromark';
import { gfm } from 'micromark-extension-gfm';

import { htmlNodes, reconcileDom } from './dom-reconcile.js';
import { renderMarkdown } from './markdown.js';
import { provisionalMarkdown } from './streaming-markdown.js';

/**
 * Incremental Markdown rendering: each finished top-level block is converted
 * to HTML and DOM once, and only the unfinished end is rendered again.
 *
 * Block boundaries come from micromark's own CommonMark + GFM tokenizer, so
 * they are exact. A block is finished once a later top-level block has
 * started on a complete line: CommonMark decides block structure line by
 * line, and a closed block never reopens. A partial last line can still
 * change what it is (`#` becomes `#tag`, a fence gains an invalid info
 * string, indentation is still arriving), so it never finishes a block. Only
 * the source after the last finished block is tokenized again.
 *
 * The output equals rendering the whole source at once:
 * - Blocks are joined by one line ending, as micromark joins them, and a
 *   trailing line ending after the last block adds one more.
 * - Link reference definitions apply across the document, so every block that
 *   may hold references renders with the known definitions appended. While
 *   streaming, definitions in unfinished blocks are left out, so a partial
 *   destination never becomes a link.
 * - GFM footnotes number and collect across the whole document, so a source
 *   containing `[^` renders as one block.
 *
 * While streaming, the unfinished end renders as provisional Markdown.
 */

const SYNTAX = { extensions: [gfm()] };
/** Whitespace tokens between blocks; they never start a block. */
const SEPARATOR_TOKENS: ReadonlySet<string> = new Set([
  'lineEnding',
  'lineEndingBlank',
  'linePrefix',
  'listItemIndent',
  'whitespace',
]);
/** Blocks whose content is literal, so link references can't occur in them. */
const LITERAL_BLOCKS: ReadonlySet<string> = new Set(['codeFenced', 'codeIndented', 'htmlFlow']);
const FOOTNOTE_MARKER = '[^';
const LINE_ENDING = /[\n\r]/;

interface BlockSpan {
  readonly type: string;
  /** Start of the line the block begins on, so its indentation is kept. */
  readonly start: number;
  readonly end: number;
  readonly definitions: string[];
}

interface Segment {
  dom: Node[];
  /** Block source, before definitions are appended (provisional while open). */
  readonly source: string;
  /** Code or HTML: link references can't occur, so definitions are never appended. */
  readonly literal: boolean;
  /** Markdown last rendered into `dom`, including appended definitions. */
  readonly rendered: string;
  readonly separator: boolean;
  readonly trailing: boolean;
}

interface PaintInput {
  readonly source: string;
  readonly literal: boolean;
  readonly separator: boolean;
  readonly trailing: boolean;
  readonly definitions: readonly string[];
}

/** Top-level blocks of `source`, in order, from micromark's tokenizer. */
function blockSpans(source: string): BlockSpan[] {
  const events = postprocess(
    parse(SYNTAX)
      .document()
      .write(preprocess()(source, undefined, true)),
  );
  const spans: BlockSpan[] = [];
  let depth = 0;
  for (const [kind, token] of events) {
    if (kind === 'exit') {
      depth -= 1;
      continue;
    }
    if (depth === 0 && !SEPARATOR_TOKENS.has(token.type)) {
      const lineStart = source.lastIndexOf('\n', token.start.offset - 1) + 1;
      spans.push({ type: token.type, start: lineStart, end: token.end.offset, definitions: [] });
    } else if (depth === 1 && token.type === 'definition') {
      spans.at(-1)?.definitions.push(source.slice(token.start.offset, token.end.offset));
    }
    depth += 1;
  }
  return spans;
}

export class MarkdownBlocks {
  private readonly finished: Segment[] = [];
  private open: Segment | undefined = undefined;
  /** The source prefix covered by finished blocks. */
  private finishedSource = '';
  private finishedHasContent = false;
  private readonly finishedDefinitions: string[] = [];
  /** Definitions the finished blocks were last rendered with. */
  private appliedDefinitions = '';

  /** Current DOM, in order. */
  public nodes(): Node[] {
    const nodes = this.finished.flatMap((segment) => segment.dom);
    return this.open === undefined ? nodes : [...nodes, ...this.open.dom];
  }

  /**
   * Renders `source` into `target` just before `end`. While `streaming`, the
   * unfinished end is provisional. Returns whether it was repaired.
   */
  public render(target: Element, source: string, streaming: boolean, end: Node | null): boolean {
    const whole = source.includes(FOOTNOTE_MARKER);
    if (!source.startsWith(this.finishedSource) || (whole && this.finished.length > 0)) {
      this.clear(target);
    }
    const offset = this.finishedSource.length;
    const tail = source.slice(offset);
    const spans: BlockSpan[] = whole ? wholeSpan(tail) : blockSpans(tail);

    // Block i is finished once block i + 1 starts on a complete line.
    const lastLineStart = Math.max(tail.lastIndexOf('\n'), tail.lastIndexOf('\r')) + 1;
    let finishedCount = 0;
    while ((spans[finishedCount + 1]?.start ?? Number.POSITIVE_INFINITY) < lastLineStart) {
      finishedCount += 1;
    }
    const newlyFinished = spans.slice(0, finishedCount);
    const unfinished = spans.slice(finishedCount);
    for (const span of newlyFinished) {
      this.finishedDefinitions.push(...span.definitions);
    }
    const definitions = streaming
      ? [...this.finishedDefinitions]
      : [...this.finishedDefinitions, ...unfinished.flatMap((span) => span.definitions)];
    this.refreshReferences(target, definitions, end);

    // The previous unfinished DOM is reconciled against every block that now
    // replaces it, so an element that was already shown keeps its identity.
    const inputs: PaintInput[] = newlyFinished.map((span) => ({
      source: tail.slice(span.start, span.end),
      literal: LITERAL_BLOCKS.has(span.type),
      separator: false,
      trailing: false,
      definitions,
    }));
    const first = unfinished[0];
    const last = unfinished.at(-1);
    const block =
      first === undefined || last === undefined ? '' : tail.slice(first.start, last.end);
    const repaired = streaming && block.length > 0 ? provisionalMarkdown(block) : undefined;
    if (last !== undefined) {
      inputs.push({
        source: repaired?.source ?? block,
        literal: unfinished.every((span) => LITERAL_BLOCKS.has(span.type)),
        separator: false,
        trailing: LINE_ENDING.test(tail.slice(last.end)),
        definitions,
      });
    }
    const open = this.open;
    const reuse =
      newlyFinished.length === 0 && open !== undefined && inputs.length === 1
        ? unchanged(open, inputs[0], this.finishedHasContent)
        : false;
    if (!reuse) {
      let hasContent = this.finishedHasContent;
      const segments = inputs.map((input) => {
        const segment = build(target, { ...input, separator: hasContent });
        hasContent ||= segment.dom.length > 0;
        return segment;
      });
      const placed = reconcileDom(
        target,
        open?.dom ?? [],
        segments.flatMap((segment) => segment.dom),
        open?.dom[0] ?? end,
      );
      let index = 0;
      for (const segment of segments) {
        segment.dom = placed.slice(index, index + segment.dom.length);
        index += segment.dom.length;
      }
      this.open = last === undefined ? undefined : segments.pop();
      for (const [index, segment] of segments.entries()) {
        const span = newlyFinished[index];
        this.finished.push(segment);
        this.finishedHasContent ||= segment.dom.length > 0;
        if (span !== undefined) {
          this.finishedSource = source.slice(0, offset + span.end);
        }
      }
    }
    return repaired?.provisional === true;
  }

  /** Removes all rendered DOM and forgets every block. */
  public clear(target: Element): void {
    for (const node of this.nodes()) {
      target.removeChild(node);
    }
    this.finished.length = 0;
    this.open = undefined;
    this.finishedSource = '';
    this.finishedHasContent = false;
    this.finishedDefinitions.length = 0;
    this.appliedDefinitions = '';
  }

  /** Renders finished blocks again when the definitions they may reference change. */
  private refreshReferences(
    target: Element,
    definitions: readonly string[],
    end: Node | null,
  ): void {
    const key = definitions.join('\n');
    if (key === this.appliedDefinitions) {
      return;
    }
    this.appliedDefinitions = key;
    for (const [index, segment] of this.finished.entries()) {
      if (segment.literal || segment.dom.length === 0 || !segment.source.includes('[')) {
        continue;
      }
      const next =
        this.finished.slice(index + 1).find((later) => later.dom.length > 0)?.dom[0] ??
        this.open?.dom[0] ??
        end;
      const rebuilt = build(target, { ...segment, definitions });
      rebuilt.dom = reconcileDom(target, segment.dom, rebuilt.dom, segment.dom[0] ?? next);
      this.finished[index] = rebuilt;
    }
  }
}

/** Renders one block's Markdown into detached nodes. */
function build(target: Element, input: PaintInput): Segment {
  const rendered = renderedMarkdown(input);
  const html = rendered.trim().length === 0 ? '' : renderMarkdown(rendered).replace(/\n+$/, '');
  const text =
    html.length === 0 ? '' : `${input.separator ? '\n' : ''}${html}${input.trailing ? '\n' : ''}`;
  return {
    dom: htmlNodes(target, text),
    source: input.source,
    literal: input.literal,
    rendered,
    separator: input.separator,
    trailing: input.trailing,
  };
}

/** The block with the known definitions appended when it may reference them. */
function renderedMarkdown(input: PaintInput): string {
  const refs = !input.literal && input.source.includes('[') && input.definitions.length > 0;
  return refs ? `${input.source}\n\n${input.definitions.join('\n')}` : input.source;
}

function unchanged(segment: Segment, input: PaintInput | undefined, separator: boolean): boolean {
  return (
    input !== undefined &&
    segment.rendered === renderedMarkdown(input) &&
    segment.separator === separator &&
    segment.trailing === input.trailing
  );
}

/** The whole source as one block, ending before trailing blank lines. */
function wholeSpan(source: string): BlockSpan[] {
  const rest = /\s*$/.exec(source)?.[0] ?? '';
  if (rest.length === source.length) {
    return [];
  }
  const end = LINE_ENDING.test(rest) ? source.length - rest.length : source.length;
  return [{ type: 'document', start: 0, end, definitions: [] }];
}
