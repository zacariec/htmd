import { isCustomElementTag } from '@htmdjs/parser';

import type { ComponentContract } from './types.js';

/** Reserved source attribute pinning a component contract version. */
export const VERSION_ATTRIBUTE = 'data-htmd-version';

/**
 * The set of components a host makes available to a document.
 *
 * Registration in the global custom-element registry is not permission: a
 * renderer instantiates only components present in its catalog. Catalogs are
 * immutable; `with` and `without` return new catalogs.
 */
export class ComponentCatalog {
  private constructor(private readonly byTag: ReadonlyMap<string, ComponentContract>) {}

  public static of(contracts: Iterable<ComponentContract>): ComponentCatalog {
    const byTag = new Map<string, ComponentContract>();
    for (const contract of contracts) {
      assertValidContract(contract);
      if (byTag.has(contract.tag)) {
        throw new Error(`duplicate component contract for <${contract.tag}>`);
      }
      byTag.set(contract.tag, contract);
    }
    return new ComponentCatalog(byTag);
  }

  public get(tag: string): ComponentContract | undefined {
    return this.byTag.get(tag);
  }

  public has(tag: string): boolean {
    return this.byTag.has(tag);
  }

  public tags(): readonly string[] {
    return [...this.byTag.keys()];
  }

  public contracts(): readonly ComponentContract[] {
    return [...this.byTag.values()];
  }

  /** Adds contracts, replacing any existing contract for the same tag. */
  public with(...contracts: readonly ComponentContract[]): ComponentCatalog {
    const byTag = new Map(this.byTag);
    for (const contract of contracts) {
      assertValidContract(contract);
      byTag.set(contract.tag, contract);
    }
    return new ComponentCatalog(byTag);
  }

  public without(...tags: readonly string[]): ComponentCatalog {
    const byTag = new Map(this.byTag);
    for (const tag of tags) {
      byTag.delete(tag);
    }
    return new ComponentCatalog(byTag);
  }

  /** Tags whose children are a raw text payload, for the parser. */
  public rawTextTags(): ReadonlySet<string> {
    const tags = new Set<string>();
    for (const contract of this.byTag.values()) {
      if (contract.children.kind === 'text') {
        tags.add(contract.tag);
      }
    }
    return tags;
  }
}

function assertValidContract(contract: ComponentContract): void {
  if (!isCustomElementTag(contract.tag)) {
    throw new Error(`component contract tag "${contract.tag}" is not a custom-element name`);
  }
  if (!Number.isInteger(contract.version) || contract.version < 1) {
    throw new Error(`<${contract.tag}> contract version must be a positive integer`);
  }
  if (Object.hasOwn(contract.attributes, VERSION_ATTRIBUTE)) {
    throw new Error(`<${contract.tag}> must not declare reserved attribute "${VERSION_ATTRIBUTE}"`);
  }
  for (const name of Object.keys(contract.attributes)) {
    if (name.toLowerCase().startsWith('on')) {
      throw new Error(`<${contract.tag}> must not declare event-handler attribute "${name}"`);
    }
  }
}
