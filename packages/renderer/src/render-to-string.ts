import { defaultHost, resolveChildren, resolveComponent } from '@htmdjs/contracts';
import type {
  ComponentCatalog,
  ContractDiagnostic,
  HtmdDiagnostic,
  HtmdHost,
} from '@htmdjs/contracts';
import { Parser } from '@htmdjs/parser';
import type { ElementBlock, HtmdNode } from '@htmdjs/parser';

import { renderMarkdown } from './markdown.js';

/**
 * DOM-free static render for servers: the HTML `renderHtmdSource` would
 * materialize, as a string. Markdown renders to safe HTML; components the
 * host allows become their custom-element tags with validated attributes and
 * upgrade once the elements register on the client. Shadow content and data
 * loads happen there, not here. Streaming never applies, so nothing defers.
 */

export interface HtmdStringRender {
  readonly html: string;
  /** Parser diagnostics followed by contract diagnostics, as `renderHtmdSource` reports them. */
  readonly diagnostics: readonly HtmdDiagnostic[];
}

const FALLBACK_ATTR = 'data-htmd-fallback';

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '"': '&quot;',
  '<': '&lt;',
  '>': '&gt;',
  // HTML parsing would normalize a literal CR to LF.
  '\r': '&#13;',
};

export function renderHtmdToString(
  source: string,
  options: { readonly host?: HtmdHost } = {},
): HtmdStringRender {
  const host = options.host ?? defaultHost;
  const result = Parser.getInstance().parse(source, {
    rawTextTags: host.components.rawTextTags(),
  });
  const diagnostics: ContractDiagnostic[] = [];
  const html = renderNodes(result.document.nodes, host.components, diagnostics);
  return { html, diagnostics: [...result.diagnostics, ...diagnostics] };
}

function renderNodes(
  nodes: ReadonlyArray<HtmdNode>,
  catalog: ComponentCatalog,
  diagnostics: ContractDiagnostic[],
): string {
  let html = '';
  for (const node of nodes) {
    html +=
      node.type === 'markdown'
        ? markdownHtml(node.source)
        : renderElement(node, catalog, diagnostics);
  }
  return html;
}

function renderElement(
  node: ElementBlock,
  catalog: ComponentCatalog,
  diagnostics: ContractDiagnostic[],
): string {
  const { resolution, diagnostics: resolved } = resolveComponent(node, catalog, {
    streaming: false,
  });
  diagnostics.push(...resolved);

  if (resolution.kind !== 'render') {
    // `defer` needs streaming; a static render only falls back.
    let projection: string;
    if (resolution.contract?.children.kind === 'text') {
      const rawText = node.children.map((child) => child.source).join('');
      // HTML parsing drops one newline right after `<pre>`; lead with one so the text survives.
      projection = `<pre>${rawText.startsWith('\n') ? '\n' : ''}${escapeHtml(rawText)}</pre>`;
    } else {
      projection = markdownHtml(markdownProjection(node.children));
    }
    return `<div ${FALLBACK_ATTR}="${escapeHtml(node.tag)}">${projection}</div>`;
  }

  let html = `<${node.tag}`;
  for (const [name, value] of Object.entries(resolution.attrs)) {
    html += ` ${name}="${escapeHtml(value)}"`;
  }
  html += '>';
  const content = resolveChildren(node, resolution.contract);
  diagnostics.push(...content.diagnostics);
  switch (resolution.contract.children.kind) {
    case 'none':
      break;
    case 'text':
      html += escapeHtml(node.children.map((child) => child.source).join(''));
      break;
    default:
      html += renderNodes(content.children, catalog, diagnostics);
  }
  return `${html}</${node.tag}>`;
}

/** Whitespace-only Markdown materializes nothing. */
function markdownHtml(source: string): string {
  return source.trim().length === 0 ? '' : renderMarkdown(source);
}

/** Every descendant Markdown span with element wrappers flattened. */
function markdownProjection(nodes: ReadonlyArray<HtmdNode>): string {
  let text = '';
  for (const node of nodes) {
    text += node.type === 'markdown' ? node.source : markdownProjection(node.children);
  }
  return text;
}

/** Escapes text and double-quoted attribute values alike. */
function escapeHtml(text: string): string {
  return text.replace(/[&"<>\r]/g, (char) => ESCAPES[char] ?? char);
}
