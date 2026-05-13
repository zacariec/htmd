import '@htmd/elements';
import { Parser } from '@htmd/parser';

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

const { document: parsed, diagnostics } = Parser.getInstance().parse(SAMPLE);

console.info('parsed:', parsed);
if (diagnostics.length > 0) {
  console.warn('diagnostics:', diagnostics);
}

// Naive renderer for the example: write the source as innerHTML so the browser
// upgrades custom elements. A real consumer would walk the AST, render
// markdown spans via marked/remark, and mount element nodes individually.
stage.innerHTML = SAMPLE;

stage.addEventListener('choice', (event) => {
  const detail = (event as CustomEvent<{ name: string; value: string }>).detail;
  console.info('choice selected:', detail);
});
