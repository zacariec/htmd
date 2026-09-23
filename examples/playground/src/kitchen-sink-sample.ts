/**
 * Everything HTMD renders in one document: streaming Markdown, all nine base
 * components, host-loaded data, and three sources the contracts refuse.
 */
export const KITCHEN_SINK_HTMD = `# Kitchen sink

Everything HTMD renders, in one document. Press **Play** and watch it stream, then change the controls.

## Markdown while it streams

Emphasis *closes early*, **strong text shows before its closer arrives**, ~~strikethrough~~ too, and \`inline code\` renders as code. Intraword stays literal: 2*3 = 6 and snake_case_names.

A link becomes clickable only once its destination is complete: [the HTMD spec](https://github.com/zacariec/htmd/blob/main/spec/htmd-spec.md). Bare URLs stream as text first: https://github.com/zacariec/htmd and hello@example.com.

> **Quoted:** blockquotes keep *inline* formatting.

1. Ordered lists
2. With **nested** items
   - bullet one
   - bullet two
3. And task lists:

- [x] Buffer partial tags
- [ ] Ship the next alpha

| Week | Revenue | Note |
| ---- | ------: | ---- |
| w49 | 171,050 | billing bug |
| w51 | **236,200** | best week |

\`\`\`ts
// Fenced code is literal: <choice-group> here is just text.
const total = rows.reduce((sum, row) => sum + row.revenue, 0);
\`\`\`

---

## Components

<chat-message author="agent" author-name="Navigator" status="complete" created-at="2026-09-23T09:15:00Z">

Messages hold Markdown **and** components. Each choice appears only once it is complete:

<choice-group name="next">
  <choice-item value="forecast">Build the Q1 forecast</choice-item>
  <choice-item value="deep-dive">Deep-dive on **w49**</choice-item>
  <choice-item value="export">Export the table</choice-item>
</choice-group>

Pick one, then type here while the rest streams. Both survive:

<refine-prompt target="$.answer" placeholder="Ask for a revision…"></refine-prompt>

</chat-message>

### Data, loaded through the host

Rows arrive in batches from the host's loader:

<data-table src="/api/sales/q4"/>

This source fails after two batches; the rows already shown stay:

<data-table src="/api/sales/flaky" error-text="The flaky source failed."/>

### Media and files

<image-card src="/charts/q4-revenue.svg" alt="Weekly revenue, w40–w52" width="1200" height="480" caption="Weekly revenue, w40–w52"/>

<file-preview name="q4-sales.csv" mime="text/csv" size-bytes="228" href="/files/q4-sales.csv"/>

### Literal code and structured fragments

<code-block language="ts">const corrected = invoices.filter((invoice) => !invoice.voided);
// Raw text: **not bold**, <not-a-component/> stays literal.</code-block>

<htmd-fragment kind="highlights" state="{&quot;best&quot;:&quot;w51&quot;,&quot;worst&quot;:&quot;w49&quot;,&quot;items&quot;:[&quot;Recovery +9% after the billing fix&quot;,&quot;Churn flat at 2.1%&quot;]}">{"tag":"div","class":"highlights","children":[{"tag":"h4","text":"Best week {{best}}, worst {{worst}}"},{"tag":"ul","children":[{"for":"item in items","tag":"li","text":"{{item}}"}]}]}</htmd-fragment>

### When the contracts say no

A component the host doesn't offer renders as text, never as markup:

<sales-widget>EMEA pipeline: **$1.2M**</sales-widget>

An image without its required \`alt\`:

<image-card src="/charts/q4-revenue.svg"/>

A component version this host doesn't support:

<file-preview data-htmd-version="2" name="report.pdf"/>

That's everything. Press **Play** again with **Random** chunking: the final document is always the same.
`;

const LONG_SECTION = (index: number): string => `## Week ${index + 1} review

Revenue grew **${(index % 9) + 3}%** week over week, driven by *enterprise* renewals. See [the weekly report](https://example.com/reports/${index + 1}) for the breakdown.

- Churn held at ${(2 + (index % 5) / 10).toFixed(1)}%
- Support tickets fell by ${index % 7} percent
- One outlier account, traced to a **billing** retry

| Metric | Value |
| ------ | ----: |
| Orders | ${1200 + index * 7} |
| Refunds | ${index % 13} |

${index % 4 === 3 ? '```ts\nconst weekly = orders.filter((order) => order.week === current);\n```\n\n' : ''}`;

/**
 * A long single-region answer (about 40 KB). Finished Markdown blocks render
 * once, so the cost per chunk stays flat however long it grows.
 */
export const LONG_ANSWER_HTMD = `# Year in review

Pick a focus now; the choice survives the whole stream.

<choice-group name="focus">
  <choice-item value="revenue">Revenue</choice-item>
  <choice-item value="churn">Churn</choice-item>
</choice-group>

${Array.from({ length: 80 }, (_, index) => LONG_SECTION(index)).join('')}That's the full year.
`;
