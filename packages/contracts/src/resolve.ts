import { DiagnosticSeverity } from '@htmdjs/parser';
import type { ElementBlock, HtmdNode } from '@htmdjs/parser';

import { VERSION_ATTRIBUTE } from './catalog.js';
import type { ComponentCatalog } from './catalog.js';
import { ContractDiagnosticCode } from './types.js';
import type { ComponentContract, ContractDiagnostic } from './types.js';

/**
 * - `render`: instantiate the component with `attrs` (validated, declared
 *   attributes only).
 * - `defer`: a `complete`-policy component is still streaming; do not
 *   instantiate it yet (renderers hold its position with a placeholder).
 * - `fallback`: do not instantiate; render a neutral text projection.
 */
export type ComponentResolution =
  | {
      readonly kind: 'render';
      readonly contract: ComponentContract;
      readonly attrs: Readonly<Record<string, string>>;
    }
  | { readonly kind: 'defer'; readonly contract: ComponentContract }
  | { readonly kind: 'fallback'; readonly contract: ComponentContract | undefined };

export interface ResolveOptions {
  /** True while the source may still grow; incomplete elements may defer. */
  readonly streaming?: boolean;
}

const MAX_QUOTED_VALUE = 80;

/**
 * Decides whether a parsed element may render, and with which attributes.
 * Precedence: availability → version pin → completeness → attributes →
 * component rules. Unknown attributes are dropped with a warning; any error
 * produces a fallback.
 */
export function resolveComponent(
  node: ElementBlock,
  catalog: ComponentCatalog,
  options: ResolveOptions = {},
): {
  readonly resolution: ComponentResolution;
  readonly diagnostics: readonly ContractDiagnostic[];
} {
  const diagnostics: ContractDiagnostic[] = [];
  const report = (
    severity: DiagnosticSeverity,
    code: ContractDiagnosticCode,
    message: string,
  ): void => {
    diagnostics.push({ severity, code, message, tag: node.tag, start: node.start, end: node.end });
  };

  const contract = catalog.get(node.tag);
  if (contract === undefined) {
    report(
      DiagnosticSeverity.Warning,
      ContractDiagnosticCode.UnknownComponent,
      `<${node.tag}> is not an available component; rendering its text only`,
    );
    return { resolution: { kind: 'fallback', contract: undefined }, diagnostics };
  }
  const fallback = { resolution: { kind: 'fallback', contract } as const, diagnostics };

  const pinned = node.attrs[VERSION_ATTRIBUTE];
  if (pinned !== undefined && pinned !== String(contract.version)) {
    report(
      DiagnosticSeverity.Error,
      ContractDiagnosticCode.UnsupportedVersion,
      `<${node.tag}> version ${quote(pinned)} is not supported; available version is ${contract.version}`,
    );
    return fallback;
  }

  if (!node.complete && contract.partial === 'complete') {
    if (options.streaming === true) {
      return { resolution: { kind: 'defer', contract }, diagnostics };
    }
    report(
      DiagnosticSeverity.Error,
      ContractDiagnosticCode.IncompleteComponent,
      `<${node.tag}> ended before its closing tag`,
    );
    return fallback;
  }

  const attrs: Record<string, string> = {};
  let failed = false;
  for (const [name, value] of Object.entries(node.attrs)) {
    if (name === VERSION_ATTRIBUTE) {
      continue;
    }
    const attribute = contract.attributes[name];
    if (attribute === undefined) {
      report(
        DiagnosticSeverity.Warning,
        ContractDiagnosticCode.UnknownAttribute,
        `<${node.tag}> does not accept "${name}"; ignored`,
      );
      continue;
    }
    if (!attribute.schema.safeParse(value).success) {
      report(
        DiagnosticSeverity.Error,
        ContractDiagnosticCode.InvalidAttribute,
        `<${node.tag}> ${name}=${quote(value)} is invalid: ${attribute.description}`,
      );
      failed = true;
      continue;
    }
    attrs[name] = value;
  }
  for (const [name, attribute] of Object.entries(contract.attributes)) {
    if (attribute.required === true && !Object.hasOwn(node.attrs, name)) {
      report(
        DiagnosticSeverity.Error,
        ContractDiagnosticCode.MissingAttribute,
        `<${node.tag}> requires "${name}": ${attribute.description}`,
      );
      failed = true;
    }
  }
  for (const issue of contract.validate?.(node) ?? []) {
    report(issue.severity, ContractDiagnosticCode.ComponentRule, issue.message);
    failed ||= issue.severity === DiagnosticSeverity.Error;
  }

  return failed ? fallback : { resolution: { kind: 'render', contract, attrs }, diagnostics };
}

/**
 * Children a rendered component receives under its contract. Disallowed
 * content is dropped with a warning; whitespace-only Markdown is ignored.
 */
export function resolveChildren(
  node: ElementBlock,
  contract: ComponentContract,
): { readonly children: readonly HtmdNode[]; readonly diagnostics: readonly ContractDiagnostic[] } {
  const policy = contract.children;
  if (policy.kind === 'text' || policy.kind === 'flow') {
    return { children: node.children, diagnostics: [] };
  }
  const children: HtmdNode[] = [];
  const diagnostics: ContractDiagnostic[] = [];
  for (const child of node.children) {
    if (child.type === 'markdown' && child.source.trim().length === 0) {
      continue;
    }
    const allowed =
      child.type === 'markdown'
        ? policy.kind === 'markdown'
        : policy.kind === 'components' && policy.allowed.includes(child.tag);
    if (allowed) {
      children.push(child);
      continue;
    }
    diagnostics.push({
      severity: DiagnosticSeverity.Warning,
      code: ContractDiagnosticCode.DisallowedChild,
      message:
        child.type === 'markdown'
          ? `<${node.tag}> does not accept text content; ignored`
          : `<${node.tag}> does not accept <${child.tag}>; ignored`,
      tag: node.tag,
      start: child.start,
      end: child.end,
    });
  }
  return { children, diagnostics };
}

/**
 * Validates parsed nodes against a catalog exactly as the renderer resolves
 * them. Producers can run this before sending a document. Fallback content is
 * rendered as text, so its descendants are not validated.
 */
export function validateNodes(
  nodes: readonly HtmdNode[],
  catalog: ComponentCatalog,
  options: ResolveOptions = {},
): readonly ContractDiagnostic[] {
  const diagnostics: ContractDiagnostic[] = [];
  const visit = (children: readonly HtmdNode[]): void => {
    for (const node of children) {
      if (node.type !== 'element') {
        continue;
      }
      const resolved = resolveComponent(node, catalog, options);
      diagnostics.push(...resolved.diagnostics);
      if (resolved.resolution.kind !== 'render') {
        continue;
      }
      const contract = resolved.resolution.contract;
      const content = resolveChildren(node, contract);
      diagnostics.push(...content.diagnostics);
      if (contract.children.kind !== 'text') {
        visit(content.children);
      }
    }
  };
  visit(nodes);
  return diagnostics;
}

function quote(value: string): string {
  return JSON.stringify(
    value.length > MAX_QUOTED_VALUE ? `${value.slice(0, MAX_QUOTED_VALUE)}…` : value,
  );
}
