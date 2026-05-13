import { LitElement, css, html, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { defineOnce } from './define-once.js';

/**
 * `<htmd-fragment>` — the escape hatch.
 *
 * Renders a JSON-described tree of safe sub-elements with one-way data binding.
 * The payload is parsed JSON, not evaluated code; bindings are restricted to
 * whitelisted lookups on a scoped state object.
 *
 * Hard rule: never `eval`, never `Function()`, never inline event handlers.
 */

const ALLOWED_TAGS = new Set(['div', 'span', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'img', 'a']);

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

interface FragmentNode {
  readonly tag: string;
  readonly class?: string;
  readonly text?: string;
  readonly children?: ReadonlyArray<FragmentNode>;
  readonly for?: string;
  readonly attrs?: Readonly<Record<string, string>>;
}

type FragmentState = Readonly<Record<string, unknown>>;

export class HtmdFragment extends LitElement {
  public static override styles = css`
    :host {
      display: block;
    }
  `;

  public static override properties = {
    kind: { type: String, reflect: true },
    state: { type: Object },
  };

  public kind: string = '';
  public state: FragmentState = {};

  protected payload: FragmentNode | undefined = undefined;

  public override connectedCallback(): void {
    super.connectedCallback();
    this.payload = this.parsePayload();
  }

  private parsePayload(): FragmentNode | undefined {
    const text = this.textContent?.trim() ?? '';
    if (text.length === 0) {
      return undefined;
    }
    try {
      const json = JSON.parse(text) as unknown;
      if (isFragmentNode(json)) {
        return json;
      }
      console.warn('[htmd/fragment] payload is not a valid fragment node');
      return undefined;
    } catch (error) {
      console.warn('[htmd/fragment] payload parse failed', error);
      return undefined;
    }
  }

  public override render(): unknown {
    if (this.payload === undefined) {
      return nothing;
    }
    return this.renderNode(this.payload, this.state);
  }

  private renderNode(node: FragmentNode, state: FragmentState): TemplateResult | typeof nothing {
    const tag = node.tag;
    const isCustom = tag.includes('-');

    if (!isCustom && !ALLOWED_TAGS.has(tag)) {
      console.warn(`[htmd/fragment] tag "${tag}" not allowed; skipping`);
      return nothing;
    }

    if (node.for !== undefined) {
      return this.renderLoop(node, state);
    }

    const text = node.text !== undefined ? interpolate(node.text, state) : '';
    const children = (node.children ?? []).map((child) => this.renderNode(child, state));

    return this.renderTag(tag, node, text, children);
  }

  private renderLoop(node: FragmentNode, state: FragmentState): TemplateResult | typeof nothing {
    if (node.for === undefined) {
      return nothing;
    }
    const loopMatch = /^([a-z_][a-z0-9_]*)\s+in\s+([a-z_][a-z0-9_]*)$/i.exec(node.for);
    if (loopMatch === null) {
      console.warn(`[htmd/fragment] invalid for expression: "${node.for}"`);
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
    const { for: _, ...rest } = node;
    const childNode: FragmentNode = rest;
    return html`${list.map((item) => this.renderNode(childNode, { ...state, [itemName]: item }))}`;
  }

  private renderTag(
    tag: string,
    node: FragmentNode,
    text: string,
    children: ReadonlyArray<TemplateResult | typeof nothing>,
  ): TemplateResult {
    const safeAttrs = filterAttrs(tag, node.attrs ?? {});
    const className = node.class ?? safeAttrs['class'] ?? '';

    /* eslint-disable lit/no-template-bind */
    return html`<div class=${className}>
      ${text.length > 0 ? text : null}${children}
    </div>`;
    /* eslint-enable lit/no-template-bind */
  }
}

function isFragmentNode(value: unknown): value is FragmentNode {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record['tag'] === 'string';
}

function interpolate(template: string, state: FragmentState): string {
  return template.replace(/\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/gi, (_, key: string) => {
    const value = state[key];
    return value === undefined ? '' : String(value);
  });
}

function filterAttrs(
  tag: string,
  attrs: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const allowed = ALLOWED_ATTRS_BY_TAG[tag];
  if (allowed === undefined) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(attrs)) {
    if (allowed.has(name) && !value.toLowerCase().includes('javascript:')) {
      result[name] = value;
    }
  }
  return result;
}

defineOnce('htmd-fragment', HtmdFragment);
