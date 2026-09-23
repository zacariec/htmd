import { z } from 'zod';

import { originRegion } from './events.js';

/** JSON-compatible component state. */
export type InteractionValue =
  | string
  | number
  | boolean
  | null
  | readonly InteractionValue[]
  | { readonly [key: string]: InteractionValue };

export const InteractionValue: z.ZodType<InteractionValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(InteractionValue),
    z.record(z.string(), InteractionValue),
  ]),
);

/**
 * Implemented by components whose user-owned state (a selection, a draft)
 * should survive the element being recreated, e.g. a page reload.
 */
export interface StatefulComponent {
  /** Current user-owned state, or `undefined` when there is nothing worth keeping. */
  htmdSnapshot(): InteractionValue | undefined;
  /**
   * Applies previously captured state. Restoration is not a user action: it
   * must not emit intents. Implementations ignore state they do not recognise.
   */
  htmdRestore(state: InteractionValue): void;
}

export function isStatefulComponent(element: Element): element is Element & StatefulComponent {
  const candidate = element as Element & Partial<StatefulComponent>;
  return (
    typeof candidate.htmdSnapshot === 'function' && typeof candidate.htmdRestore === 'function'
  );
}

/**
 * Serializable interaction state of a rendered document. Components are keyed
 * by origin region, tag, and ordinal among stateful components with the same
 * region and tag, so the key is stable when the same source renders again.
 */
export const InteractionSnapshot = z.object({
  version: z.literal(1),
  components: z.array(
    z.object({
      region: z.string(),
      tag: z.string(),
      index: z.number().int().nonnegative(),
      state: InteractionValue,
    }),
  ),
});
export type InteractionSnapshot = z.output<typeof InteractionSnapshot>;

/** Records the state of every stateful component under `root` that has any. */
export function captureInteractionState(root: ParentNode): InteractionSnapshot {
  const components: InteractionSnapshot['components'] = [];
  walkStateful(root, (element, region, index) => {
    const state = element.htmdSnapshot();
    if (state !== undefined) {
      components.push({ region, tag: element.localName, index, state });
    }
  });
  return { version: 1, components };
}

/**
 * Applies `snapshot` to the stateful components under `root` whose key
 * matches, returning how many were restored. An invalid snapshot restores
 * nothing; entries without a matching component are ignored.
 */
export function restoreInteractionState(root: ParentNode, snapshot: unknown): number {
  const parsed = InteractionSnapshot.safeParse(snapshot);
  if (!parsed.success) {
    return 0;
  }
  const states = new Map<string, InteractionValue>();
  for (const entry of parsed.data.components) {
    states.set(JSON.stringify([entry.region, entry.tag, entry.index]), entry.state);
  }
  let restored = 0;
  walkStateful(root, (element, region, index) => {
    const state = states.get(JSON.stringify([region, element.localName, index]));
    if (state !== undefined) {
      element.htmdRestore(state);
      restored += 1;
    }
  });
  return restored;
}

/**
 * Visits stateful descendants of `root` in document order, descending into
 * open shadow roots (an element's shadow tree before its light children),
 * with each element's ordinal among stateful elements sharing its region and
 * tag.
 */
function walkStateful(
  root: ParentNode,
  visit: (element: Element & StatefulComponent, region: string, index: number) => void,
): void {
  const ordinals = new Map<string, number>();
  const stack: Element[] = composedChildren(root).reverse();
  let element = stack.pop();
  while (element !== undefined) {
    if (isStatefulComponent(element)) {
      const region = originRegion(element) ?? '';
      const group = JSON.stringify([region, element.localName]);
      const index = ordinals.get(group) ?? 0;
      ordinals.set(group, index + 1);
      visit(element, region, index);
    }
    stack.push(...composedChildren(element).reverse());
    element = stack.pop();
  }
}

/** Open shadow-tree children first, then light children. */
function composedChildren(node: ParentNode): Element[] {
  const shadow = (node as Partial<Element>).shadowRoot?.children ?? [];
  return [...shadow, ...node.children];
}
