import { Parser, isCustomElementTag } from '@htmdjs/parser';
import type { ElementBlock, HtmdNode, ParseResult } from '@htmdjs/parser';

import { renderMarkdown } from './markdown.js';

/**
 * AST → DOM materializer — the single code path for turning parsed `.htmd`
 * nodes into live DOM. Used by the static render helper and by the streaming
 * `RegionTreeRenderer` (which re-materializes one region per chunk).
 *
 * Markdown blocks render through `renderMarkdown` (raw HTML escaped). Element
 * blocks become real elements; the custom-element registry upgrades them.
 * `on*` attributes are never set — the parser reports them, the materializer
 * refuses them.
 */

/** Elements whose children are a raw text payload, never parsed as .htmd. */
const RAW_TEXT_TAGS: ReadonlySet<string> = new Set(['htmd-fragment']);

interface RenderedBlock {
  node: HtmdNode;
  dom: Node[];
  streaming: boolean;
}

const renderedBlocks = new WeakMap<Element, RenderedBlock[]>();
const sourceAttributes = new WeakMap<Element, Readonly<Record<string, string>>>();

/**
 * Reconcile positional source blocks, retaining live elements and their state.
 * Only changed Markdown blocks are rendered again; Markdown remains provisional
 * while streaming, with the same safe rendering policy as final/static output.
 * Clearing the target explicitly discards its previous materialization.
 */
export function materializeInto(
  target: Element,
  nodes: ReadonlyArray<HtmdNode>,
  options?: { streaming?: boolean },
): void {
  const streaming = options?.streaming === true;
  let blocks = renderedBlocks.get(target);
  if (
    blocks === undefined ||
    blocks.some((block) => block.dom.some((node) => node.parentNode !== target))
  ) {
    if (target.firstChild !== null) {
      target.replaceChildren();
    }
    blocks = [];
    renderedBlocks.set(target, blocks);
  }

  let index = 0;
  let cursor = target.firstChild;
  for (const node of nodes) {
    if (node.type === 'element' && !isCustomElementTag(node.tag)) {
      continue;
    }
    const previous = blocks[index];
    const last = previous?.dom.at(-1);
    const after = last === undefined ? cursor : last.nextSibling;
    if (
      previous !== undefined &&
      previous.node.type === node.type &&
      (node.type !== 'element' ||
        (previous.node.type === 'element' && previous.node.tag === node.tag))
    ) {
      if (previous.node.source !== node.source || previous.streaming !== streaming) {
        if (node.type === 'markdown') {
          previous.dom = reconcileDom(
            target,
            previous.dom,
            markdownNodes(target, node.source),
            cursor,
          );
        } else {
          const element = previous.dom[0] as Element;
          reconcileAttrs(element, node.attrs);
          updateElementContent(element, node, streaming);
        }
        previous.node = node;
        previous.streaming = streaming;
      }
    } else {
      const dom =
        node.type === 'markdown'
          ? markdownNodes(target, node.source)
          : [createElement(target, node, streaming)];
      for (const child of dom) {
        target.insertBefore(child, cursor);
      }
      for (const child of previous?.dom ?? []) {
        target.removeChild(child);
      }
      blocks[index] = { node, dom, streaming };
    }
    cursor = after;
    index += 1;
  }
  for (let i = index; i < blocks.length; i += 1) {
    for (const child of blocks[i]?.dom ?? []) {
      target.removeChild(child);
    }
  }
  blocks.length = index;
}

/** Parses `source` and materializes it into `target`. Returns the parse result
 * so callers can inspect diagnostics. */
export function renderHtmdSource(target: Element, source: string): ParseResult {
  const result = Parser.getInstance().parse(source);
  materializeInto(target, result.document.nodes);
  return result;
}

function createElement(target: Element, node: ElementBlock, streaming: boolean): Element {
  const element = target.ownerDocument.createElement(node.tag);
  reconcileAttrs(element, node.attrs);
  updateElementContent(element, node, streaming);
  return element;
}

function updateElementContent(element: Element, node: ElementBlock, streaming: boolean): void {
  if (RAW_TEXT_TAGS.has(node.tag)) {
    const text = rawTextOf(node);
    if (element.textContent !== text) {
      element.textContent = text;
    }
  } else {
    materializeInto(element, node.children, { streaming });
  }
}

function markdownNodes(target: Element, source: string): Node[] {
  if (source.trim().length === 0) {
    return [];
  }
  const template = target.ownerDocument.createElement('template');
  template.innerHTML = renderMarkdown(source);
  const nodes = Array.from(template.content.childNodes);
  for (const node of nodes) {
    rememberMarkdownAttrs(node);
  }
  return nodes;
}

function rememberMarkdownAttrs(node: Node): void {
  if (node.nodeType !== 1) {
    return;
  }
  const element = node as Element;
  sourceAttributes.set(
    element,
    Object.fromEntries(Array.from(element.attributes, (attr) => [attr.name, attr.value])),
  );
  for (const child of element.childNodes) {
    rememberMarkdownAttrs(child);
  }
}

/** Diff safe Markdown DOM without detaching matching siblings or descendants. */
function reconcileDom(
  target: Element,
  current: Node[],
  incoming: Node[],
  start: Node | null,
): Node[] {
  let cursor = start;
  let i = 0;
  for (const next of incoming) {
    const previous = current[i];
    if (
      previous !== undefined &&
      previous.nodeType === next.nodeType &&
      previous.nodeName === next.nodeName
    ) {
      if (previous.nodeType === 1) {
        const element = previous as Element;
        const nextElement = next as Element;
        reconcileAttrs(element, sourceAttributes.get(nextElement) ?? {});
        reconcileDom(
          element,
          Array.from(element.childNodes),
          Array.from(nextElement.childNodes),
          element.firstChild,
        );
      } else if (previous.nodeValue !== next.nodeValue) {
        previous.nodeValue = next.nodeValue;
      }
      incoming[i] = previous;
      cursor = previous.nextSibling;
    } else {
      target.insertBefore(next, cursor);
      if (previous !== undefined) {
        cursor = previous.nextSibling;
        target.removeChild(previous);
      }
    }
    i += 1;
  }
  for (let index = incoming.length; index < current.length; index += 1) {
    const child = current[index];
    if (child !== undefined) target.removeChild(child);
  }
  return incoming;
}

/** Only source deltas may overwrite reflected/user state on live elements. */
function reconcileAttrs(element: Element, attrs: Readonly<Record<string, string>>): void {
  const previous = sourceAttributes.get(element);
  if (previous !== undefined) {
    for (const name of Object.keys(previous)) {
      if (
        !name.toLowerCase().startsWith('on') &&
        !Object.hasOwn(attrs, name) &&
        element.hasAttribute(name)
      ) {
        element.removeAttribute(name);
      }
    }
  }
  for (const [name, value] of Object.entries(attrs)) {
    if (
      !name.toLowerCase().startsWith('on') &&
      (previous === undefined || previous[name] !== value) &&
      element.getAttribute(name) !== value
    ) {
      element.setAttribute(name, value);
    }
  }
  sourceAttributes.set(element, attrs);
}

/** Sets attributes, refusing `on*` event-handler names. */
export function applySafeAttrs(element: Element, attrs: Readonly<Record<string, string>>): void {
  for (const [name, value] of Object.entries(attrs)) {
    if (name.toLowerCase().startsWith('on') || element.getAttribute(name) === value) {
      continue;
    }
    element.setAttribute(name, value);
  }
}

function rawTextOf(node: ElementBlock): string {
  return node.children.map((child) => child.source).join('');
}
