import { HtmdElementEvents, registerHtmdElements } from '@zacariec/htmd-elements';
import { renderHtmdSource } from '@zacariec/htmd-renderer';

registerHtmdElements();

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

const result = renderHtmdSource(stage, SAMPLE);
if (result.diagnostics.length > 0) {
  console.info('htmd diagnostics:', result.diagnostics);
}

stage.addEventListener(HtmdElementEvents.Choice, (event) => {
  const detail = (event as CustomEvent<{ name: string; value: string }>).detail;
  console.info('choice selected:', detail);
});
