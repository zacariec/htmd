import { isCustomElementTag } from '@htmdjs/parser';
import { LitElement, css, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { ref } from 'lit/directives/ref.js';
import { html, unsafeStatic } from 'lit/static-html.js';
import type { StaticValue } from 'lit/static-html.js';
import { z } from 'zod';

import { HtmdElementsLogger } from './internal/logger.js';
import { sanitizeUrl } from './internal/sanitize-url.js';

/**
 * `<htmd-fragment>` — the escape hatch.
 *
 * Renders a JSON-described tree of safe sub-elements with one-way data
 * binding. The payload is parsed JSON validated by Zod, never evaluated code;
 * bindings are flat `{{key}}` lookups on a scoped state object.
 *
 * Tags materialise via `lit/static-html` — `unsafeStatic(tag)` is acceptable
 * because every tag passes the allowlist (or the custom-element name check)
 * first. URL-bearing attributes go through `sanitizeUrl`.
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

const URL_ATTR_NAMES: ReadonlySet<string> = new Set([
  'src',
  'href',
  'action',
  'formaction',
  'poster',
]);

const MAX_RENDER_DEPTH = 32;
const MAX_LOOP_ITEMS = 1000;

const FragmentNodeSchema = z.object({
  tag: z.string(),
  class: z.string().optional(),
  text: z.string().optional(),
  for: z.string().optional(),
  attrs: z.record(z.string(), z.string()).optional(),
  get children() {
    return z.array(FragmentNodeSchema).optional();
  },
});

type FragmentNode = z.output<typeof FragmentNodeSchema>;

const FragmentStateSchema = z.record(z.string(), z.unknown());

type FragmentState = z.output<typeof FragmentStateSchema>;

/** Lit renderables the fragment can produce — templates, nothing, or lists. */
type FragmentRenderResult = TemplateResult | typeof nothing | ReadonlyArray<FragmentRenderResult>;

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
    const parsed = FragmentStateSchema.safeParse(JSON.parse(value) as unknown);
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

    const parsed = FragmentNodeSchema.safeParse(json);
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
    return this.renderNode(this.payload, this.state, 0);
  }

  private renderNode(
    node: FragmentNode,
    state: FragmentState,
    depth: number,
  ): FragmentRenderResult {
    if (depth > MAX_RENDER_DEPTH) {
      HtmdElementsLogger.getInstance().warn('fragment payload exceeds maximum depth; truncating');
      return nothing;
    }

    if (node.for !== undefined) {
      return this.renderLoop(node, state, depth);
    }

    const tag = node.tag.toLowerCase();
    const text = node.text === undefined ? '' : interpolate(node.text, state);
    const children = (node.children ?? []).map((child) => this.renderNode(child, state, depth + 1));

    if (ALLOWED_TAGS.has(tag)) {
      return this.renderNativeTag(tag, node, text, children);
    }

    if (isCustomElementTag(tag) && typeof customElements !== 'undefined') {
      if (customElements.get(tag) === undefined) {
        HtmdElementsLogger.getInstance().warn(`fragment tag "${tag}" is not registered; skipping`);
        return nothing;
      }
      return this.renderCustomTag(tag, node, text, children);
    }

    HtmdElementsLogger.getInstance().warn(`fragment tag "${tag}" not allowed; skipping`);
    return nothing;
  }

  private renderLoop(
    node: FragmentNode,
    state: FragmentState,
    depth: number,
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
      this.renderNode(itemNode, { ...state, [itemName]: item }, depth + 1),
    );
  }

  private renderNativeTag(
    tag: string,
    node: FragmentNode,
    text: string,
    children: ReadonlyArray<FragmentRenderResult>,
  ): TemplateResult {
    const attrs = this.safeNativeAttrs(tag, node);
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

  private renderCustomTag(
    tag: string,
    node: FragmentNode,
    text: string,
    children: ReadonlyArray<FragmentRenderResult>,
  ): TemplateResult {
    const attrs = this.safeCustomAttrs(node);
    const staticTag = staticTagFor(tag);

    return html`<${staticTag} ${ref((element) => {
      if (element === undefined) {
        return;
      }
      for (const [name, value] of Object.entries(attrs)) {
        element.setAttribute(name, value);
      }
    })}>${text.length > 0 ? text : nothing}${children}</${staticTag}>`;
  }

  /**
   * Filters attrs down to the per-tag allowlist, sanitizes URL attributes,
   * folds `node.class` in, and forces `rel="noopener noreferrer"` on links
   * that open a new browsing context.
   */
  private safeNativeAttrs(tag: string, node: FragmentNode): Readonly<Record<string, string>> {
    const allowed = ALLOWED_ATTRS_BY_TAG[tag];
    const result: Record<string, string> = {};

    if (allowed !== undefined) {
      for (const [name, value] of Object.entries(node.attrs ?? {})) {
        const attrName = name.toLowerCase();
        if (!allowed.has(attrName)) {
          continue;
        }
        const safeValue = this.safeAttrValue(attrName, value);
        if (safeValue === undefined) {
          continue;
        }
        result[attrName] = safeValue;
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

  private safeCustomAttrs(node: FragmentNode): Readonly<Record<string, string>> {
    const result: Record<string, string> = {};

    for (const [name, value] of Object.entries(node.attrs ?? {})) {
      const attrName = name.toLowerCase();
      if (attrName.startsWith('on') || attrName === 'style') {
        HtmdElementsLogger.getInstance().warn(
          `fragment attribute "${attrName}" not allowed; skipping`,
        );
        continue;
      }
      const safeValue = this.safeAttrValue(attrName, value);
      if (safeValue === undefined) {
        continue;
      }
      result[attrName] = safeValue;
    }

    if (node.class !== undefined) {
      result['class'] = node.class;
    }

    return result;
  }

  private safeAttrValue(attrName: string, value: string): string | undefined {
    if (!URL_ATTR_NAMES.has(attrName)) {
      return value;
    }
    const sanitized = sanitizeUrl(value);
    if (sanitized === undefined) {
      HtmdElementsLogger.getInstance().warn(
        `fragment attribute "${attrName}" carries a disallowed URL; skipping`,
      );
    }
    return sanitized;
  }
}
