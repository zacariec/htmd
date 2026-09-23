export const SAMPLE_HTMD = `# .htmd playground

Type on the left, watch the tree render on the right. This sample shows every element the base library ships with.

<chat-message author="agent" author-name="Navigator" status="complete" created-at="2026-08-01T09:15:00Z">

## Code

<code-block language="ts">const total = orders.reduce((sum, order) => sum + order.cents, 0);
return total / 100;</code-block>

## Image

<image-card src="/charts/q4-revenue.png" alt="Q4 revenue by week" width="1200" height="675" caption="Weekly revenue, w40-w52"/>

## Data

The playground host authorizes this endpoint and streams its rows in batches.

<data-table src="/api/sales/q4"/>

## File

<file-preview name="q4-full-report.pdf" mime="application/pdf" size-bytes="482133" href="/files/q4-full-report.pdf"/>

## Highlights

<htmd-fragment kind="highlights">{"tag":"div","class":"highlights","children":[{"tag":"h4","text":"Highlights"},{"tag":"ul","children":[{"tag":"li","text":"Best week: w51"},{"tag":"li","text":"Worst week: w49"},{"tag":"li","text":"Recovery: +9% after fix"}]}]}</htmd-fragment>

## Next

<choice-group name="next">
  <choice-item value="dig">Dig into the top performer</choice-item>
  <choice-item value="export">Export the table</choice-item>
  <choice-item value="another">Show a different cut</choice-item>
</choice-group>

<refine-prompt target="$.msg.body" placeholder="Ask a follow-up on this section…"></refine-prompt>

</chat-message>
`;
