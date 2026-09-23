import { DiagnosticSeverity } from '@htmdjs/parser';
import type { ElementBlock } from '@htmdjs/parser';
import { RegionId } from '@htmdjs/wire';
import { z } from 'zod';

import { ComponentCatalog } from './catalog.js';
import { ChoiceDetail, ComponentEvents, RefineDetail } from './events.js';
import { FragmentNode, FragmentState } from './payloads.js';
import type { AttributeContract, ComponentContract, ContractIssue } from './types.js';

const label = (max: number): z.ZodType => z.string().trim().min(1).max(max);
const text = (max: number): z.ZodType => z.string().max(max);
const url = z.string().trim().min(1).max(2048);
const positiveInteger = z.string().regex(/^[1-9]\d{0,5}$/);
const nonNegativeInteger = z.string().regex(/^(0|[1-9]\d{0,15})$/);
const flag = z.enum(['', 'true', 'false']);

function jsonObject(value: string): boolean {
  try {
    return FragmentState.safeParse(JSON.parse(value) as unknown).success;
  } catch {
    return false;
  }
}

function source(
  description: string,
  schema: z.ZodType,
  extra: Partial<AttributeContract> = {},
): AttributeContract {
  return { description, schema, ownership: 'source', ...extra };
}

export const chatMessageContract: ComponentContract = {
  tag: 'chat-message',
  version: 1,
  description: 'A message container: author metadata plus Markdown and component body content.',
  attributes: {
    author: source('one of "user", "agent", or "system"', z.enum(['user', 'agent', 'system']), {
      required: true,
    }),
    'author-id': source('stable author identifier, at most 128 characters', label(128)),
    'author-name': source('display name, at most 128 characters', label(128)),
    status: source(
      'one of "streaming", "complete", or "failed"',
      z.enum(['streaming', 'complete', 'failed']),
    ),
    'created-at': source('ISO 8601 timestamp with offset', z.iso.datetime({ offset: true })),
  },
  children: { kind: 'flow' },
  partial: 'progressive',
  partialBehavior:
    'Body content renders as it arrives. `status` is source-owned, so producers update it as the message completes or fails.',
  state: 'No user-owned state; nested components own their own state.',
  events: [],
  effects: [],
  accessibility:
    'Exposed as an article labelled by its author. Sets aria-busy while status is "streaming".',
  examples: [
    '<chat-message author="agent" author-name="Navigator" status="complete" created-at="2026-09-23T09:15:00Z">\n\nQ4 revenue grew **12%**.\n\n</chat-message>',
  ],
};

function duplicateChoiceValues(node: ElementBlock): readonly ContractIssue[] {
  const seen = new Set<string>();
  const issues: ContractIssue[] = [];
  for (const child of node.children) {
    if (child.type !== 'element' || child.tag !== 'choice-item') {
      continue;
    }
    const value = child.attrs['value'];
    if (value === undefined) {
      continue;
    }
    if (seen.has(value)) {
      issues.push({
        severity: DiagnosticSeverity.Warning,
        message: `<choice-group> has duplicate choice value ${JSON.stringify(value)}; values must be unique`,
      });
    }
    seen.add(value);
  }
  return issues;
}

export const choiceGroupContract: ComponentContract = {
  tag: 'choice-group',
  version: 1,
  description: 'A single-selection set of choices; selecting one emits a `choice` intent.',
  attributes: {
    name: source(
      'identifier: a letter followed by letters, digits, "_" or "-" (at most 64)',
      z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),
      { required: true },
    ),
    value: {
      description: 'initially selected choice value, at most 256 characters',
      schema: text(256),
      ownership: 'initial',
    },
  },
  children: { kind: 'components', allowed: ['choice-item'] },
  partial: 'progressive',
  partialBehavior:
    'Complete choices appear as they arrive. A choice is not interactive until its closing tag arrives. The current selection applies to choices that arrive later.',
  state:
    'Selection is user-owned: after creation, source changes to `value` are ignored. Explicit region replacement resets it.',
  events: [
    {
      name: ComponentEvents.Choice,
      description: 'Selection changed by the user.',
      detail: ChoiceDetail,
    },
  ],
  effects: ['emit-intent'],
  accessibility:
    'radiogroup with radio choices. One choice is in the tab order; arrow keys move focus and selection; Home/End jump to the ends.',
  examples: [
    '<choice-group name="next">\n  <choice-item value="forecast">Build the Q1 forecast</choice-item>\n  <choice-item value="deep-dive">Deep-dive on w49</choice-item>\n</choice-group>',
  ],
  validate: duplicateChoiceValues,
};

export const choiceItemContract: ComponentContract = {
  tag: 'choice-item',
  version: 1,
  description: 'One option inside a `<choice-group>`; its Markdown content is the label.',
  attributes: {
    value: source('non-empty choice value, at most 256 characters', label(256), {
      required: true,
    }),
  },
  children: { kind: 'markdown' },
  partial: 'complete',
  partialBehavior:
    'Not rendered until its closing tag arrives, so a user never selects a partially written option.',
  state: 'Selected state is owned by the enclosing group; source cannot set it.',
  events: [],
  effects: [],
  accessibility: 'radio with aria-checked; label is its content.',
  examples: [
    '<choice-group name="confirm"><choice-item value="yes">Yes, continue</choice-item></choice-group>',
  ],
};

export const codeBlockContract: ComponentContract = {
  tag: 'code-block',
  version: 1,
  description: 'Literal code. Content is raw text: never Markdown, never components.',
  attributes: {
    language: source(
      'language label: letters, digits, "+", "#", ".", "_" or "-" (at most 32)',
      z.string().regex(/^[A-Za-z0-9+#._-]{1,32}$/),
    ),
    'show-copy': source('"true" or "false" (default true)', flag),
  },
  children: { kind: 'text' },
  partial: 'progressive',
  partialBehavior: 'Code text renders as it streams; it is never interpreted.',
  state: 'No user-owned state.',
  events: [],
  effects: ['clipboard'],
  accessibility: 'Copy is a labelled button; copying happens only on user activation.',
  examples: ['<code-block language="ts">const total = orders.length;</code-block>'],
};

export const dataTableContract: ComponentContract = {
  tag: 'data-table',
  version: 1,
  description:
    'Tabular data loaded through the host. Payload `{ columns: string[], rows: Record<string, unknown>[] }`.',
  attributes: {
    src: source('data URL; loaded only when the host authorizes "data"', url, {
      required: true,
      url: 'data',
    }),
    'loading-text': source('loading message, at most 200 characters', text(200)),
    'empty-text': source('empty-table message, at most 200 characters', text(200)),
    'error-text': source('failure message, at most 200 characters', text(200)),
  },
  children: { kind: 'none' },
  partial: 'complete',
  partialBehavior:
    'Renders once its tag is complete. Host loaders may deliver validated row batches, which appear progressively; incomplete rows never render. States: blocked, loading, partial, loaded, empty, interrupted, failed. At most 5000 rows render.',
  state:
    'Loaded data belongs to the element for its current `src`. Changing `src`, replacing the region, or removing the element cancels outstanding loads; late results are discarded.',
  events: [],
  effects: ['load-data'],
  accessibility: 'Native table with header cells; state changes are announced politely.',
  examples: ['<data-table src="/api/sales/q4"/>'],
};

export const filePreviewContract: ComponentContract = {
  tag: 'file-preview',
  version: 1,
  description: 'A file reference with an optional download link.',
  attributes: {
    name: source('file name, at most 256 characters', label(256), { required: true }),
    mime: source(
      'MIME type such as "application/pdf"',
      z.string().regex(/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/),
    ),
    'size-bytes': source('non-negative integer byte count', nonNegativeInteger),
    href: source('download URL; exposed only when the host authorizes "download"', url, {
      url: 'download',
    }),
  },
  children: { kind: 'none' },
  partial: 'complete',
  partialBehavior: 'Renders once its tag is complete.',
  state: 'No user-owned state.',
  events: [],
  effects: ['download'],
  accessibility: 'Download link is labelled with the file name.',
  examples: [
    '<file-preview name="q4-report.pdf" mime="application/pdf" size-bytes="52344" href="/files/q4-report.pdf"/>',
  ],
};

export const imageCardContract: ComponentContract = {
  tag: 'image-card',
  version: 1,
  description: 'An image with required alternative text and optional caption.',
  attributes: {
    src: source('image URL; loaded only when the host authorizes "image"', url, {
      required: true,
      url: 'image',
    }),
    alt: source('alternative text, at most 500 characters', text(500), { required: true }),
    width: source('intrinsic width in pixels', positiveInteger),
    height: source('intrinsic height in pixels', positiveInteger),
    caption: source('caption, at most 500 characters', text(500)),
  },
  children: { kind: 'none' },
  partial: 'complete',
  partialBehavior:
    'Renders once its tag is complete. Width and height reserve space before the image loads.',
  state: 'No user-owned state.',
  events: [],
  effects: ['load-image'],
  accessibility:
    'Image uses the required alt text; when the host blocks the URL, the alt text is shown instead.',
  examples: [
    '<image-card src="/charts/q4-revenue.png" alt="Weekly revenue, w40-w52" width="1200" height="675" caption="Weekly revenue"/>',
  ],
};

export const refinePromptContract: ComponentContract = {
  tag: 'refine-prompt',
  version: 1,
  description: 'A request to revise a region; submitting emits a `refine` intent.',
  attributes: {
    target: source('region id to revise, such as "$.answer"', RegionId, { required: true }),
    placeholder: source('input placeholder, at most 120 characters', text(120)),
    'submit-label': source('submit button label, at most 120 characters', label(120)),
    'working-label': source('label while submitting, at most 120 characters', label(120)),
  },
  children: { kind: 'none' },
  partial: 'complete',
  partialBehavior: 'Renders once its tag is complete.',
  state:
    'Draft text, selection, focus, and submission state are user-owned and survive streaming and finalization. The host ends a submission with `reset(clearInput?)`.',
  events: [
    {
      name: ComponentEvents.Refine,
      description:
        'User submitted a non-empty revision request; the form stays disabled until reset.',
      detail: RefineDetail,
    },
  ],
  effects: ['emit-intent'],
  accessibility: 'Labelled textarea and submit button; busy state is exposed while submitting.',
  examples: ['<refine-prompt target="$.answer"/>'],
};

function fragmentPayload(node: ElementBlock): readonly ContractIssue[] {
  const payload = node.children
    .map((child) => child.source)
    .join('')
    .trim();
  let json: unknown;
  try {
    json = JSON.parse(payload) as unknown;
  } catch {
    return [
      { severity: DiagnosticSeverity.Error, message: '<htmd-fragment> payload is not valid JSON' },
    ];
  }
  return FragmentNode.safeParse(json).success
    ? []
    : [
        {
          severity: DiagnosticSeverity.Error,
          message:
            '<htmd-fragment> payload is not a fragment node { tag, class?, text?, for?, attrs?, children? }',
        },
      ];
}

export const htmdFragmentContract: ComponentContract = {
  tag: 'htmd-fragment',
  version: 1,
  description:
    'Structured escape hatch: a JSON node tree of allowlisted native tags and host-available components, with `{{key}}` bindings to `state`.',
  attributes: {
    kind: source(
      'identifier describing the fragment (at most 64)',
      z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),
    ),
    state: source(
      'JSON object used for bindings, at most 65536 characters',
      z.string().max(65_536).refine(jsonObject),
    ),
  },
  children: { kind: 'text' },
  partial: 'complete',
  partialBehavior:
    'Not rendered until its closing tag arrives and the complete payload validates; partial JSON never renders.',
  state: 'No user-owned state; nested components own their own state.',
  events: [],
  effects: [],
  accessibility:
    'Renders only allowlisted semantic tags; nested components carry their own contracts.',
  examples: [
    '<htmd-fragment kind="card" state="{&quot;title&quot;:&quot;Q4&quot;,&quot;items&quot;:[&quot;Revenue up&quot;,&quot;Churn flat&quot;]}">{"tag":"div","children":[{"tag":"h3","text":"{{title}}"},{"tag":"ul","children":[{"for":"item in items","tag":"li","text":"{{item}}"}]}]}</htmd-fragment>',
  ],
  validate: (node) => (node.complete ? fragmentPayload(node) : []),
};

export const baseContracts: readonly ComponentContract[] = [
  chatMessageContract,
  choiceGroupContract,
  choiceItemContract,
  codeBlockContract,
  dataTableContract,
  filePreviewContract,
  imageCardContract,
  refinePromptContract,
  htmdFragmentContract,
];

/** The base component set. Hosts narrow it with `without` or extend it with `with`. */
export const baseCatalog: ComponentCatalog = ComponentCatalog.of(baseContracts);
