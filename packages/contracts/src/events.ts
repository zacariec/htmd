import { RegionId } from '@htmdjs/wire';
import { z } from 'zod';

/**
 * Public intents dispatched by base components.
 *
 * Every event bubbles and is composed, so hosts listen on any ancestor
 * (typically the region root or the document). `region` identifies the
 * nearest enclosing `data-htmd-region`, so hosts can attribute intents even
 * when several documents share a page.
 */
export enum ComponentEvents {
  /** A `<choice-group>` selection changed. */
  Choice = 'choice',
  /** A `<refine-prompt>` was submitted. */
  Refine = 'refine',
}

export const ChoiceDetail = z.object({
  name: z.string(),
  value: z.string(),
  region: RegionId.optional(),
});
export type ChoiceDetail = z.output<typeof ChoiceDetail>;

export const RefineDetail = z.object({
  target: RegionId,
  prompt: z.string().min(1),
  region: RegionId.optional(),
});
export type RefineDetail = z.output<typeof RefineDetail>;

const REGION_ATTR = 'data-htmd-region';

/**
 * Nearest enclosing region id, crossing shadow roots so components rendered
 * inside another component's shadow tree still attribute their intents.
 */
export function originRegion(element: Element): string | undefined {
  let current: Element | undefined = element;
  while (current !== undefined) {
    const region = current.closest(`[${REGION_ATTR}]`);
    if (region !== null) {
      return region.getAttribute(REGION_ATTR) ?? undefined;
    }
    // Documents have no host; shadow roots expose the element that owns them.
    current = (current.getRootNode() as Partial<ShadowRoot>).host;
  }
  return undefined;
}
