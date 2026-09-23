import { Parser } from '@htmdjs/parser';

import type { ComponentCatalog } from './catalog.js';
import { validateNodes } from './resolve.js';
import type { ComponentContract } from './types.js';

export interface ModelInstructionsOptions {
  /** Include each contract's examples as fenced code blocks. Defaults to true. */
  readonly examples?: boolean;
}

const FORBIDDEN_TAGS = [
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'link',
  'meta',
  'base',
  'form',
] as const;

/**
 * Markdown instructions describing how to write `.htmd` for `catalog`,
 * suitable for a system prompt. Deterministic: components appear in catalog
 * order, attributes in contract order. Only the catalog's components are
 * mentioned, so a narrowed catalog never advertises a withheld component:
 * allowed children are filtered to the catalog and examples that do not
 * validate against it are omitted.
 */
export function modelInstructions(
  catalog: ComponentCatalog,
  options: ModelInstructionsOptions = {},
): string {
  const contracts = catalog.contracts();
  if (contracts.length === 0) {
    return [
      '# Output format',
      '',
      'Write Markdown only. No components are available: do not emit HTML or custom-element tags; any tag is shown to the reader as plain text.',
      '',
    ].join('\n');
  }
  const examples = options.examples ?? true;
  const lines = [
    '# Output format',
    '',
    'Write `.htmd`: Markdown for prose, plus the components listed below when structure or interaction is required. Content that breaks a component contract is shown to the reader as plain text instead of a working component.',
    '',
    '## Rules',
    '',
    '- Write prose in Markdown. Do not use plain HTML tags such as `<p>`, `<div>`, `<span>`, `<a>`, `<img>`, or `<table>`; only the custom-element components listed below render.',
    '- Use only the components listed below. Any other tag is shown as plain text.',
    '- Use only the attributes listed for each component; unknown attributes are ignored. Give every required attribute a valid value: a missing or invalid attribute turns the component into plain text.',
    '- Double-quote every attribute value. Encode `"` inside a value as `&quot;`.',
    '- Close every non-self-closing tag promptly.',
    `- Never emit ${FORBIDDEN_TAGS.map((tag) => `\`<${tag}>\``).join(', ')}. No \`on*\` attributes, no \`javascript:\` URLs, no \`data:\` URLs.`,
    '- A URL is a request, not permission to load it. The host decides which images, links, downloads, and data load.',
    '- To show a component literally without rendering it, put it inside a code fence or inline code span.',
    '',
    '## Components',
  ];
  for (const contract of contracts) {
    lines.push('', ...describeContract(contract, catalog, examples));
  }
  lines.push('');
  return lines.join('\n');
}

function describeContract(
  contract: ComponentContract,
  catalog: ComponentCatalog,
  examples: boolean,
): string[] {
  const lines = [`### \`<${contract.tag}>\``, '', contract.description, ''];
  const attributes = Object.entries(contract.attributes);
  if (attributes.length === 0) {
    lines.push('Attributes: none.');
  } else {
    lines.push('Attributes:');
    for (const [name, attribute] of attributes) {
      const required = attribute.required === true ? ' (required)' : '';
      lines.push(`- \`${name}\`${required}: ${attribute.description}`);
    }
  }
  lines.push('', `Content: ${describeChildren(contract, catalog)}`);
  if (contract.partial === 'complete') {
    lines.push(
      '',
      contract.children.kind === 'none'
        ? 'Appears only once its tag is complete (the `/>` has arrived), so finish it promptly.'
        : 'Appears only once its closing tag arrives, so close it promptly.',
    );
  }
  if (examples) {
    const rawTextTags = catalog.rawTextTags();
    for (const example of contract.examples) {
      // An example relying on a withheld component would teach an unavailable tag.
      const parsed = Parser.getInstance().parse(example, { rawTextTags });
      if (
        parsed.diagnostics.length > 0 ||
        validateNodes(parsed.document.nodes, catalog).length > 0
      ) {
        continue;
      }
      const fence = fenceFor(example);
      lines.push('', `${fence}htmd`, example, fence);
    }
  }
  return lines;
}

function describeChildren(contract: ComponentContract, catalog: ComponentCatalog): string {
  const children = contract.children;
  switch (children.kind) {
    case 'none':
      return `none. Write it self-closing: \`<${contract.tag} …/>\`.`;
    case 'text':
      return 'literal raw text, shown exactly as written and never parsed as Markdown or components. Do not escape it.';
    case 'markdown':
      return 'Markdown only; components inside it are dropped.';
    case 'flow':
      return 'Markdown and the components listed here.';
    case 'components': {
      const allowed = children.allowed.filter((tag) => catalog.has(tag));
      return allowed.length === 0
        ? 'none available in this host; any content is dropped.'
        : `only ${allowed.map((tag) => `\`<${tag}>\``).join(', ')}; any other content, including text, is dropped.`;
    }
  }
}

/** A backtick fence longer than any backtick run inside `content`. */
function fenceFor(content: string): string {
  let longest = 0;
  for (const run of content.match(/`+/g) ?? []) {
    longest = Math.max(longest, run.length);
  }
  return '`'.repeat(Math.max(3, longest + 1));
}
