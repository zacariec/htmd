import { defaultHost, provideHtmdHost, resolveChildren, resolveComponent } from '@htmdjs/contracts';
import type {
  ComponentCatalog,
  ComponentContract,
  ComponentResolution,
  ContractDiagnostic,
  HtmdDiagnostic,
  HtmdHost,
} from '@htmdjs/contracts';
import { Parser } from '@htmdjs/parser';
import type { ElementBlock, HtmdDocument, HtmdNode } from '@htmdjs/parser';

import { renderMarkdown } from './markdown.js';
import { provisionalMarkdown } from './streaming-markdown.js';

/**
 * AST → DOM materializer — the single code path for turning parsed `.htmd`
 * nodes into live DOM. Used by the static render helper and by the streaming
 * `RegionTreeRenderer` (which re-materializes one region per chunk).
 *
 * Markdown blocks render through `renderMarkdown` (raw HTML escaped). While
 * streaming, the frontier — the last Markdown node, including the last child
 * of a component still streaming — renders as provisional Markdown: open
 * inline syntax is completed and ambiguous syntax withheld, so readers never
 * see markers that later vanish. Element blocks resolve against the host's
 * component catalog:
 *
 * - `render`: a real element with validated, declared attributes only. The
 *   custom-element registry upgrades it. Children follow the contract.
 * - `defer`: `<div data-htmd-deferred="tag" aria-busy="true">`, a styleable
 *   placeholder holding the block's position until the component resolves.
 * - `fallback`: `<div data-htmd-fallback="tag">` holding a text projection.
 *   Nothing inside a fallback is ever instantiated.
 *
 * Registration in the global custom-element registry is not permission: tags
 * outside the catalog always fall back.
 */

export interface MaterializeOptions {
  /** True while the source may still grow; incomplete `complete`-policy components defer. */
  readonly streaming?: boolean;
  /** Decides which components render. Defaults to `defaultHost`. */
  readonly host?: HtmdHost;
}

export interface RenderResult {
  readonly document: HtmdDocument;
  /** Known incomplete syntax (always false for a static render). */
  readonly pending: boolean;
  /** Parser diagnostics followed by contract diagnostics. */
  readonly diagnostics: readonly HtmdDiagnostic[];
}

const FALLBACK_ATTR = 'data-htmd-fallback';
const DEFERRED_ATTR = 'data-htmd-deferred';

type BlockKind = 'markdown' | ComponentResolution['kind'];

interface RenderedBlock {
  node: HtmdNode;
  kind: BlockKind;
  dom: Node[];
  streaming: boolean;
  /** Rendered as the streaming frontier (provisional Markdown allowed). */
  frontier: boolean;
  /** The frontier Markdown in this block was completed or withheld. */
  provisional: boolean;
  catalog: ComponentCatalog;
  /** Contract diagnostics of this block's subtree, reused while it is unchanged. */
  diagnostics: readonly ContractDiagnostic[];
}

const renderedBlocks = new WeakMap<Element, RenderedBlock[]>();
const sourceAttributes = new WeakMap<Element, Readonly<Record<string, string>>>();

/**
 * Reconcile positional source blocks, retaining live elements and their state.
 * Only changed blocks are resolved and rendered again. A block whose
 * resolution kind or tag changes is replaced. Clearing the target explicitly
 * discards its previous materialization. Returns the contract diagnostics for
 * `nodes`.
 */
export function materializeInto(
  target: Element,
  nodes: ReadonlyArray<HtmdNode>,
  options: MaterializeOptions = {},
): readonly ContractDiagnostic[] {
  return materializeStreaming(target, nodes, options).diagnostics;
}

/**
 * `materializeInto` that also reports whether the streaming frontier is
 * provisional. Internal to the renderer package.
 */
export function materializeStreaming(
  target: Element,
  nodes: ReadonlyArray<HtmdNode>,
  options: MaterializeOptions,
): { readonly diagnostics: readonly ContractDiagnostic[]; readonly provisional: boolean } {
  const streaming = options.streaming === true;
  return materializeNodes(target, nodes, streaming, options.host ?? defaultHost, streaming);
}

function materializeNodes(
  target: Element,
  nodes: ReadonlyArray<HtmdNode>,
  streaming: boolean,
  host: HtmdHost,
  frontier: boolean,
): { readonly diagnostics: readonly ContractDiagnostic[]; readonly provisional: boolean } {
  const catalog = host.components;
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

  const diagnostics: ContractDiagnostic[] = [];
  let provisional = false;
  let index = 0;
  let cursor = target.firstChild;
  for (const node of nodes) {
    const previous = blocks[index];
    const last = previous?.dom.at(-1);
    const after = last === undefined ? cursor : last.nextSibling;
    const atFrontier = frontier && index === nodes.length - 1;
    if (
      previous === undefined ||
      previous.node.type !== node.type ||
      previous.node.source !== node.source ||
      previous.streaming !== streaming ||
      previous.frontier !== atFrontier ||
      previous.catalog !== catalog
    ) {
      blocks[index] = renderBlock(target, node, previous, cursor, streaming, host, atFrontier);
    }
    diagnostics.push(...(blocks[index]?.diagnostics ?? []));
    provisional ||= blocks[index]?.provisional === true;
    cursor = after;
    index += 1;
  }
  for (let i = index; i < blocks.length; i += 1) {
    for (const child of blocks[i]?.dom ?? []) {
      target.removeChild(child);
    }
  }
  blocks.length = index;
  return { diagnostics, provisional };
}

/**
 * Parses `source` with the host's raw-text tags, provides `host` (default
 * `defaultHost`) to the rendered components, and materializes into `target`.
 */
export function renderHtmdSource(
  target: Element,
  source: string,
  options: { readonly host?: HtmdHost } = {},
): RenderResult {
  const host = options.host ?? defaultHost;
  provideHtmdHost(target, host);
  const result = Parser.getInstance().parse(source, {
    rawTextTags: host.components.rawTextTags(),
  });
  const contractDiagnostics = materializeInto(target, result.document.nodes, { host });
  return {
    document: result.document,
    pending: result.pending,
    diagnostics: [...result.diagnostics, ...contractDiagnostics],
  };
}

/** Renders one block, updating `previous` in place when its kind and tag still match. */
function renderBlock(
  target: Element,
  node: HtmdNode,
  previous: RenderedBlock | undefined,
  cursor: Node | null,
  streaming: boolean,
  host: HtmdHost,
  frontier: boolean,
): RenderedBlock {
  const catalog = host.components;
  if (node.type === 'markdown') {
    const view = frontier ? provisionalMarkdown(node.source) : undefined;
    const incoming = markdownNodes(target, view?.source ?? node.source);
    const dom =
      previous?.kind === 'markdown'
        ? reconcileDom(target, previous.dom, incoming, cursor)
        : replaceDom(target, previous, incoming, cursor);
    return {
      node,
      kind: 'markdown',
      dom,
      streaming,
      frontier,
      provisional: view?.provisional === true,
      catalog,
      diagnostics: [],
    };
  }

  const resolved = resolveComponent(node, catalog, { streaming });
  const resolution = resolved.resolution;
  const diagnostics = [...resolved.diagnostics];
  const reusable =
    previous !== undefined &&
    previous.kind === resolution.kind &&
    previous.node.type === 'element' &&
    previous.node.tag === node.tag;
  let dom: Node[];
  let provisional = false;
  switch (resolution.kind) {
    case 'render': {
      const existing = reusable ? (previous.dom[0] as Element | undefined) : undefined;
      const element = existing ?? target.ownerDocument.createElement(node.tag);
      if (existing === undefined) {
        // Initial-owned values apply once; afterwards the component owns them.
        for (const [name, value] of Object.entries(resolution.attrs)) {
          element.setAttribute(name, value);
        }
        sourceAttributes.set(element, sourceOwned(resolution.contract, resolution.attrs));
      } else {
        reconcileAttrs(element, sourceOwned(resolution.contract, resolution.attrs));
      }
      // Only a component still streaming carries the frontier into its children.
      provisional = renderChildren(
        element,
        node,
        resolution.contract,
        streaming,
        host,
        frontier && !node.complete,
        diagnostics,
      );
      dom = existing === undefined ? replaceDom(target, previous, [element], cursor) : [element];
      break;
    }
    case 'defer': {
      if (reusable && previous.dom[0] !== undefined) {
        dom = previous.dom;
        break;
      }
      const placeholder = target.ownerDocument.createElement('div');
      placeholder.setAttribute(DEFERRED_ATTR, node.tag);
      placeholder.setAttribute('aria-busy', 'true');
      dom = replaceDom(target, previous, [placeholder], cursor);
      break;
    }
    case 'fallback': {
      const existing = reusable ? (previous.dom[0] as Element | undefined) : undefined;
      const wrapper = existing ?? target.ownerDocument.createElement('div');
      const content = fallbackNodes(wrapper, node, resolution.contract);
      if (existing === undefined) {
        wrapper.setAttribute(FALLBACK_ATTR, node.tag);
        wrapper.append(...content);
        dom = replaceDom(target, previous, [wrapper], cursor);
      } else {
        reconcileDom(wrapper, Array.from(wrapper.childNodes), content, wrapper.firstChild);
        dom = [wrapper];
      }
      break;
    }
  }
  return {
    node,
    kind: resolution.kind,
    dom,
    streaming,
    frontier,
    provisional,
    catalog,
    diagnostics,
  };
}

/** Inserts `dom` at the block position and removes the block's previous DOM. */
function replaceDom(
  target: Element,
  previous: RenderedBlock | undefined,
  dom: Node[],
  cursor: Node | null,
): Node[] {
  for (const child of dom) {
    target.insertBefore(child, cursor);
  }
  for (const child of previous?.dom ?? []) {
    target.removeChild(child);
  }
  return dom;
}

/** Materializes a rendered component's children; returns whether its frontier is provisional. */
function renderChildren(
  element: Element,
  node: ElementBlock,
  contract: ComponentContract,
  streaming: boolean,
  host: HtmdHost,
  frontier: boolean,
  diagnostics: ContractDiagnostic[],
): boolean {
  const content = resolveChildren(node, contract);
  diagnostics.push(...content.diagnostics);
  switch (contract.children.kind) {
    case 'none':
      return false;
    case 'text': {
      const text = rawTextOf(node);
      if (element.textContent !== text) {
        element.textContent = text;
      }
      return false;
    }
    default: {
      const result = materializeNodes(element, content.children, streaming, host, frontier);
      diagnostics.push(...result.diagnostics);
      return result.provisional;
    }
  }
}

/**
 * Text projection for a component that must not render: raw text for text
 * contracts, otherwise every descendant Markdown span with element wrappers
 * flattened, rendered as safe Markdown.
 */
function fallbackNodes(
  wrapper: Element,
  node: ElementBlock,
  contract: ComponentContract | undefined,
): Node[] {
  if (contract?.children.kind === 'text') {
    const pre = wrapper.ownerDocument.createElement('pre');
    pre.textContent = rawTextOf(node);
    return [pre];
  }
  return markdownNodes(wrapper, markdownProjection(node.children));
}

function markdownProjection(nodes: ReadonlyArray<HtmdNode>): string {
  let text = '';
  for (const node of nodes) {
    text += node.type === 'markdown' ? node.source : markdownProjection(node.children);
  }
  return text;
}

function sourceOwned(
  contract: ComponentContract,
  attrs: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const owned: Record<string, string> = {};
  for (const [name, value] of Object.entries(attrs)) {
    if (contract.attributes[name]?.ownership === 'source') {
      owned[name] = value;
    }
  }
  return owned;
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

/**
 * Applies source deltas only: attributes the source previously set and no
 * longer sets are removed, changed ones are updated. Attributes the source
 * never owned (reflected or runtime state) are left alone.
 */
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
