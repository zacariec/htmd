import { ComponentEvents, baseCatalog, createHost } from '@htmdjs/contracts';
import type { ChoiceDetail } from '@htmdjs/contracts';
import { registerHtmdElements } from '@htmdjs/elements';
import { renderHtmdSource } from '@htmdjs/renderer';

registerHtmdElements();

// This page loads no data, so tables are not offered to documents at all.
const host = createHost({ components: baseCatalog.without('data-table') });

const SAMPLE = `Looking at the data now.

<chat-message author="agent" author-name="Navigator" status="complete">
  Three options to pick from:

  <choice-group name="next-step">
    <choice-item value="dig">Dig into the top performer</choice-item>
    <choice-item value="export">Export the table</choice-item>
    <choice-item value="another">Show me a different cut</choice-item>
  </choice-group>
</chat-message>
`;

const stage = document.getElementById('stage');
if (stage === null) {
  throw new Error('missing #stage');
}

const result = renderHtmdSource(stage, SAMPLE, { host });
if (result.diagnostics.length > 0) {
  console.info('htmd diagnostics:', result.diagnostics);
}

stage.addEventListener(ComponentEvents.Choice, (event) => {
  const detail = (event as CustomEvent<ChoiceDetail>).detail;
  console.info('choice selected:', detail);
});
