import {
  FragmentNode,
  FragmentState,
  authorizeComponentUrl,
  requestHtmdHost,
  resolveComponent,
} from '@htmdjs/contracts';
import type { ComponentContract, HtmdHost, UrlPurpose } from '@htmdjs/contracts';
import type { ElementBlock } from '@htmdjs/parser';
import { LitElement, css, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { ref } from 'lit/directives/ref.js';
import { html, unsafeStatic } from 'lit/static-html.js';
import type { StaticValue } from 'lit/static-html.js';

import { HtmdElementsLogger } from './internal/logger.js';

/**
 * `<htmd-fragment>` — the escape hatch.
 *
 * Renders a JSON-described tree of safe sub-elements with one-way data
 * binding. The payload is parsed JSON validated against the contract's
 * `FragmentNode` schema, never evaluated code; bindings are flat `{{key}}`
 * lookups on a scoped state object.
 *
 * Tags materialise via `lit/static-html` — `unsafeStatic(tag)` is acceptable
 * because every tag is either on the native allowlist or a component the
 * host's catalog resolves. Components receive only contract-validated
 * attributes and children; being registered as a custom element is not
 * permission. Native `img` sources and `a` links are authorized with the
 * host like any component URL.
 *
 * Hard rule: never `eval`, never `Function()`, never inline event handlers.
 */

const ALLOWED_TAGS: ReadonlySet<string> = new Set([
  'div',
  'span',
  'h2',
  'h3',
  'h4',
  'ul',
  'ol',
  'li',
  'img',
  'a',
]);

const ALLOWED_ATTRS_BY_TAG: Readonly<Record<string, ReadonlySet<string>>> = {
  div: new Set(['class']),
  span: new Set(['class']),
  h2: new Set(['class']),
  h3: new Set(['class']),
  h4: new Set(['class']),
  ul: new Set(['class']),
  ol: new Set(['class']),
  li: new Set(['class']),
  img: new Set(['class', 'src', 'alt', 'width', 'height']),
  a: new Set(['class', 'href', 'target', 'rel']),
};

/** URL-valued native attributes and the purpose the host authorizes them for. */
const URL_PURPOSE_BY_ATTR: Readonly<Record<string, UrlPurpose>> = {
  src: 'image',
  href: 'link',
};

const MAX_RENDER_DEPTH = 32;
const MAX_LOOP_ITEMS = 1000;

/** Lit renderables the fragment can produce — templates, text, nothing, or lists. */
type FragmentRenderResult =
  | TemplateResult
  | string
  | typeof nothing
  | ReadonlyArray<FragmentRenderResult>;

const staticTagCache = new Map<string, StaticValue>();

function staticTagFor(tag: string): StaticValue {
  const cached = staticTagCache.get(tag);
  if (cached !== undefined) {
    return cached;
  }
  const created = unsafeStatic(tag);
  staticTagCache.set(tag, created);
  return created;
}

function interpolate(template: string, state: FragmentState): string {
  return template.replace(/\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/gi, (_, key: string) => {
    const value = state[key];
    return value === undefined ? '' : String(value);
  });
}

function parseStateAttribute(value: string | null): FragmentState {
  if (value === null || value.trim().length === 0) {
    return {};
  }
  try {
    const parsed = FragmentState.safeParse(JSON.parse(value) as unknown);
    if (!parsed.success) {
      HtmdElementsLogger.getInstance().warn('fragment state attribute is not an object; ignoring');
      return {};
    }
    return parsed.data;
  } catch (error) {
    HtmdElementsLogger.getInstance().warn('fragment state attribute is not valid JSON', error);
    return {};
  }
}

/** A complete source element equivalent to a fragment node, for contract resolution. */
function elementBlockFor(tag: string, node: FragmentNode, text: string): ElementBlock {
  const attrs: Record<string, string> = {};
  for (const [name, value] of Object.entries(node.attrs ?? {})) {
    attrs[name.toLowerCase()] = value;
  }
  return {
    type: 'element',
    tag,
    attrs,
    children: text.length > 0 ? [{ type: 'markdown', source: text, start: 0, end: 0 }] : [],
    selfClosing: false,
    complete: true,
    source: '',
    start: 0,
    end: 0,
  };
}

export class HtmdFragment extends LitElement {
  public static override styles = css`
    :host {
      display: block;
    }
  `;

  public static override properties = {
    kind: { type: String, reflect: true },
    state: { attribute: 'state', converter: { fromAttribute: parseStateAttribute } },
    payload: { state: true },
  };

  public kind: string = '';
  public state: FragmentState = {};

  protected payload: FragmentNode | undefined = undefined;

  private payloadObserver: MutationObserver | undefined = undefined;
  /** Component elements whose initial-owned attributes were already applied. */
  private readonly initializedComponents = new WeakSet<Element>();

  public override connectedCallback(): void {
    super.connectedCallback();
    this.refreshPayload();
    if (typeof MutationObserver !== 'undefined') {
      this.payloadObserver = new MutationObserver(() => this.refreshPayload());
      this.payloadObserver.observe(this, { childList: true, characterData: true, subtree: true });
    }
  }

  public override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.payloadObserver?.disconnect();
    this.payloadObserver = undefined;
  }

  /**
   * Re-parses the light-DOM JSON payload. Called on connect and whenever the
   * payload text mutates (streaming appends). A JSON parse failure is silent —
   * mid-stream payloads are legitimately incomplete. A shape failure on valid
   * JSON is a producer bug and warns.
   */
  private refreshPayload(): void {
    const text = this.textContent?.trim() ?? '';
    if (text.length === 0) {
      this.payload = undefined;
      return;
    }

    let json: unknown;
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      return;
    }

    const parsed = FragmentNode.safeParse(json);
    if (!parsed.success) {
      HtmdElementsLogger.getInstance().warn('fragment payload is not a valid fragment node');
      this.payload = undefined;
      return;
    }

    this.payload = parsed.data;
  }

  public override render(): FragmentRenderResult {
    if (this.payload === undefined) {
      return nothing;
    }
    return this.renderNode(this.payload, this.state, 0, requestHtmdHost(this));
  }

  private renderNode(
    node: FragmentNode,
    state: FragmentState,
    depth: number,
    host: HtmdHost,
  ): FragmentRenderResult {
    if (depth > MAX_RENDER_DEPTH) {
      HtmdElementsLogger.getInstance().warn('fragment payload exceeds maximum depth; truncating');
      return nothing;
    }

    if (node.for !== undefined) {
      return this.renderLoop(node, state, depth, host);
    }

    const tag = node.tag.toLowerCase();
    const text = node.text === undefined ? '' : interpolate(node.text, state);

    if (ALLOWED_TAGS.has(tag)) {
      const children = (node.children ?? []).map((child) =>
        this.renderNode(child, state, depth + 1, host),
      );
      return this.renderNativeTag(tag, node, text, children, host);
    }

    return this.renderComponent(tag, node, text, state, depth, host);
  }

  private renderLoop(
    node: FragmentNode,
    state: FragmentState,
    depth: number,
    host: HtmdHost,
  ): FragmentRenderResult {
    if (node.for === undefined) {
      return nothing;
    }

    const loopMatch = /^([a-z_][a-z0-9_]*)\s+in\s+([a-z_][a-z0-9_]*)$/i.exec(node.for);
    if (loopMatch === null) {
      HtmdElementsLogger.getInstance().warn(`fragment "for" expression is invalid: "${node.for}"`);
      return nothing;
    }

    const [, itemName, listName] = loopMatch;
    if (itemName === undefined || listName === undefined) {
      return nothing;
    }

    const list = state[listName];
    if (!Array.isArray(list)) {
      return nothing;
    }

    if (list.length > MAX_LOOP_ITEMS) {
      HtmdElementsLogger.getInstance().warn(
        `fragment "for" list "${listName}" exceeds ${MAX_LOOP_ITEMS} items; truncating`,
      );
    }
    const bounded = list.slice(0, MAX_LOOP_ITEMS);

    const { for: _for, ...itemNode } = node;

    return bounded.map((item) =>
      this.renderNode(itemNode, { ...state, [itemName]: item }, depth + 1, host),
    );
  }

  private renderNativeTag(
    tag: string,
    node: FragmentNode,
    text: string,
    children: ReadonlyArray<FragmentRenderResult>,
    host: HtmdHost,
  ): TemplateResult {
    const attrs = this.safeNativeAttrs(tag, node, host);
    const staticTag = staticTagFor(tag);

    if (tag === 'img') {
      return html`<${staticTag}
        class=${attrs['class'] ?? nothing}
        src=${attrs['src'] ?? nothing}
        alt=${attrs['alt'] ?? ''}
        width=${attrs['width'] ?? nothing}
        height=${attrs['height'] ?? nothing}
        loading="lazy">`;
    }

    return html`<${staticTag}
      class=${attrs['class'] ?? nothing}
      href=${attrs['href'] ?? nothing}
      target=${attrs['target'] ?? nothing}
      rel=${attrs['rel'] ?? nothing}>${text.length > 0 ? text : nothing}${children}</${staticTag}>`;
  }

  /**
   * Renders a component only when the host catalog resolves it, with its
   * validated attributes and the children its contract accepts.
   */
  private renderComponent(
    tag: string,
    node: FragmentNode,
    text: string,
    state: FragmentState,
    depth: number,
    host: HtmdHost,
  ): FragmentRenderResult {
    const { resolution, diagnostics } = resolveComponent(
      elementBlockFor(tag, node, text),
      host.components,
    );
    for (const diagnostic of diagnostics) {
      HtmdElementsLogger.getInstance().warn(`fragment: ${diagnostic.message}`);
    }
    if (resolution.kind !== 'render') {
      return nothing;
    }

    const { contract, attrs } = resolution;
    const staticTag = staticTagFor(tag);
    const applyAttributes = (element: Element | undefined): void => {
      if (element !== undefined) {
        this.applyComponentAttributes(element, contract, attrs);
      }
    };
    const content = this.renderComponentChildren(contract, node, text, state, depth, host);

    return html`<${staticTag} ${ref(applyAttributes)}>${content}</${staticTag}>`;
  }

  private renderComponentChildren(
    contract: ComponentContract,
    node: FragmentNode,
    text: string,
    state: FragmentState,
    depth: number,
    host: HtmdHost,
  ): FragmentRenderResult {
    const accepts = contract.children;
    if (accepts.kind === 'none') {
      return nothing;
    }
    if (accepts.kind === 'text') {
      return text;
    }
    const children: FragmentRenderResult[] = [];
    for (const child of node.children ?? []) {
      const childTag = child.tag.toLowerCase();
      const allowed =
        accepts.kind === 'flow' ||
        (accepts.kind === 'markdown' && ALLOWED_TAGS.has(childTag)) ||
        (accepts.kind === 'components' && accepts.allowed.includes(childTag));
      if (!allowed) {
        HtmdElementsLogger.getInstance().warn(
          `fragment <${contract.tag}> does not accept <${childTag}>; skipping`,
        );
        continue;
      }
      children.push(this.renderNode(child, state, depth + 1, host));
    }
    return accepts.kind === 'components' ? children : [text, children];
  }

  /**
   * Source-owned attributes follow the payload on every render; initial-owned
   * attributes are applied only when the element is created.
   */
  private applyComponentAttributes(
    element: Element,
    contract: ComponentContract,
    attrs: Readonly<Record<string, string>>,
  ): void {
    const created = !this.initializedComponents.has(element);
    this.initializedComponents.add(element);
    for (const [name, attribute] of Object.entries(contract.attributes)) {
      if (!created && attribute.ownership === 'initial') {
        continue;
      }
      const value = attrs[name];
      if (value === undefined) {
        element.removeAttribute(name);
      } else {
        element.setAttribute(name, value);
      }
    }
  }

  /**
   * Filters attrs down to the per-tag allowlist, authorizes URL attributes
   * with the host, folds `node.class` in, and forces `rel="noopener noreferrer"`
   * on links that open a new browsing context.
   */
  private safeNativeAttrs(
    tag: string,
    node: FragmentNode,
    host: HtmdHost,
  ): Readonly<Record<string, string>> {
    const allowed = ALLOWED_ATTRS_BY_TAG[tag];
    const result: Record<string, string> = {};

    if (allowed !== undefined) {
      for (const [name, value] of Object.entries(node.attrs ?? {})) {
        const attrName = name.toLowerCase();
        if (!allowed.has(attrName)) {
          continue;
        }
        const purpose = URL_PURPOSE_BY_ATTR[attrName];
        if (purpose === undefined) {
          result[attrName] = value;
          continue;
        }
        const url = authorizeComponentUrl(this, value, purpose, host);
        if (url === undefined) {
          HtmdElementsLogger.getInstance().warn(
            `fragment <${tag}> ${attrName} is not authorized by the host; skipping`,
          );
          continue;
        }
        result[attrName] = url.href;
      }
    }

    if (node.class !== undefined) {
      result['class'] = node.class;
    }

    if (result['target'] !== undefined) {
      result['rel'] = 'noopener noreferrer';
    }

    return result;
  }
}
