import type { Diagnostic, DiagnosticSeverity, ElementBlock } from '@htmdjs/parser';
import type { z } from 'zod';

/**
 * A component contract is the executable description of one `.htmd`
 * component: what source may contain, how it behaves while incomplete, which
 * state it owns, which intents it emits, and which host capabilities it uses.
 *
 * Contracts are DOM-free. Producers validate against them; renderers enforce
 * them; documentation and model instructions derive from them.
 */

/** Why a component needs a URL. Hosts authorize each purpose separately. */
export type UrlPurpose = 'data' | 'image' | 'link' | 'download';

/** Side effects a component may perform. Declarative; enforced through the host. */
export type ComponentEffect =
  | 'load-data'
  | 'load-image'
  | 'navigate'
  | 'download'
  | 'clipboard'
  | 'emit-intent';

/**
 * `source`: later source changes are applied to the live element.
 * `initial`: applied when the element is created; afterwards the user or the
 * component owns the value and source changes are ignored.
 */
export type AttributeOwnership = 'source' | 'initial';

export interface AttributeContract {
  readonly description: string;
  /** Validates the complete attribute string. */
  readonly schema: z.ZodType;
  readonly required?: boolean;
  readonly ownership: AttributeOwnership;
  /** URL-valued attribute; the component authorizes it with the host for this purpose. */
  readonly url?: UrlPurpose;
}

/**
 * - `none`: no content; non-whitespace children are dropped.
 * - `text`: raw text payload, never parsed as `.htmd` or Markdown.
 * - `markdown`: Markdown only; nested components are dropped.
 * - `flow`: Markdown plus any component the host catalog allows.
 * - `components`: only the listed components; other content is dropped.
 */
export type ChildrenContract =
  | { readonly kind: 'none' }
  | { readonly kind: 'text' }
  | { readonly kind: 'markdown' }
  | { readonly kind: 'flow' }
  | { readonly kind: 'components'; readonly allowed: readonly string[] };

/**
 * `progressive`: renders while its closing tag is still streaming.
 * `complete`: not instantiated until its closing tag (or self-closing tag)
 * has arrived, so partial content is never interactive.
 */
export type PartialPolicy = 'progressive' | 'complete';

export interface EventContract {
  readonly name: string;
  readonly description: string;
  readonly detail: z.ZodType;
}

export interface ContractIssue {
  readonly severity: DiagnosticSeverity;
  readonly message: string;
}

export interface ComponentContract {
  /** Custom-element tag name (must contain a hyphen). */
  readonly tag: string;
  /** Source may pin `data-htmd-version`; any other value renders a fallback. */
  readonly version: number;
  readonly description: string;
  readonly attributes: Readonly<Record<string, AttributeContract>>;
  readonly children: ChildrenContract;
  readonly partial: PartialPolicy;
  /** What readers see while the component, its children, or its data are incomplete. */
  readonly partialBehavior: string;
  /** Which runtime state the user or component owns, and what resets it. */
  readonly state: string;
  readonly events: readonly EventContract[];
  readonly effects: readonly ComponentEffect[];
  readonly accessibility: string;
  /** Complete, valid sources. Documentation and conformance run every example. */
  readonly examples: readonly [string, ...string[]];
  /** Rules spanning attributes or children. Error issues render a fallback. */
  readonly validate?: (node: ElementBlock) => readonly ContractIssue[];
}

export enum ContractDiagnosticCode {
  UnknownComponent = 'unknown-component',
  UnsupportedVersion = 'unsupported-component-version',
  MissingAttribute = 'missing-attribute',
  InvalidAttribute = 'invalid-attribute',
  UnknownAttribute = 'unknown-attribute',
  DisallowedChild = 'disallowed-child',
  IncompleteComponent = 'incomplete-component',
  ComponentRule = 'component-rule',
}

export interface ContractDiagnostic {
  readonly severity: DiagnosticSeverity;
  readonly code: ContractDiagnosticCode;
  readonly message: string;
  /** Component tag the diagnostic concerns. */
  readonly tag: string;
  readonly start: number;
  readonly end: number;
}

/** Parser and contract diagnostics share severity and source spans. */
export type HtmdDiagnostic = Diagnostic | ContractDiagnostic;
