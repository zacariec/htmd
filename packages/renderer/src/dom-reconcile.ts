import { renderMarkdown } from './markdown.js';

/**
 * DOM helpers shared by the materializer and the Markdown block cache.
 *
 * Attributes the source set are remembered per element, so later updates can
 * apply source deltas without overwriting state the element or user owns.
 */

const sourceAttributes = new WeakMap<Element, Readonly<Record<string, string>>>();

/** Records `attrs` as the source-owned attributes of a newly created element. */
export function rememberSourceAttributes(
  element: Element,
  attrs: Readonly<Record<string, string>>,
): void {
  sourceAttributes.set(element, attrs);
}

/** Parses trusted renderer HTML (safe Markdown output) into detached nodes. */
export function htmlNodes(target: Element, html: string): Node[] {
  if (html.length === 0) {
    return [];
  }
  const template = target.ownerDocument.createElement('template');
  template.innerHTML = html;
  const nodes = Array.from(template.content.childNodes);
  for (const node of nodes) {
    rememberMarkdownAttrs(node);
  }
  return nodes;
}

export function markdownNodes(target: Element, source: string): Node[] {
  return source.trim().length === 0 ? [] : htmlNodes(target, renderMarkdown(source));
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

/**
 * Diff safe Markdown DOM without detaching matching siblings or descendants.
 * `current` starts at `start` in `target`; returns the nodes now in place.
 */
export function reconcileDom(
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
export function reconcileAttrs(element: Element, attrs: Readonly<Record<string, string>>): void {
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
