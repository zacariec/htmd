import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  captureInteractionState,
  isStatefulComponent,
  restoreInteractionState,
} from '../src/interaction.js';
import type { InteractionValue, StatefulComponent } from '../src/interaction.js';

/** Holds an optional `note`; stateless until one is set. */
class NoteField extends HTMLElement implements StatefulComponent {
  public note: string | undefined = undefined;

  public htmdSnapshot(): InteractionValue | undefined {
    return this.note === undefined ? undefined : { note: this.note };
  }

  public htmdRestore(state: InteractionValue): void {
    if (typeof state === 'object' && state !== null && 'note' in state) {
      const note = state['note'];
      this.note = typeof note === 'string' ? note : undefined;
    }
  }
}

/** Renders its markup into an open shadow root. */
class ShadowHost extends HTMLElement {
  public constructor() {
    super();
    this.attachShadow({ mode: 'open' }).innerHTML = '<note-field></note-field>';
  }
}

function render(): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = `
    <section data-htmd-region="$.a">
      <note-field></note-field>
      <note-field></note-field>
    </section>
    <section data-htmd-region="$.b">
      <note-field></note-field>
      <shadow-host></shadow-host>
    </section>
  `;
  document.body.appendChild(root);
  return root;
}

function fields(root: HTMLElement): NoteField[] {
  const light = [...root.querySelectorAll('note-field')];
  const shadowed = [...root.querySelectorAll('shadow-host')].flatMap((host) => [
    ...(host.shadowRoot?.querySelectorAll('note-field') ?? []),
  ]);
  return [...light, ...shadowed].filter((field) => field instanceof NoteField);
}

beforeAll(() => {
  customElements.define('note-field', NoteField);
  customElements.define('shadow-host', ShadowHost);
});

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('interaction state', () => {
  it('recognises only elements implementing both methods', () => {
    expect(isStatefulComponent(new NoteField())).toBe(true);
    expect(isStatefulComponent(document.createElement('div'))).toBe(false);
  });

  it('round-trips through JSON across regions, same-tag siblings, and shadow roots', () => {
    const before = fields(render());
    const [a0, a1, b0, shadowed] = before;
    if (a0 === undefined || a1 === undefined || b0 === undefined || shadowed === undefined) {
      throw new Error('expected four fields');
    }
    a0.note = 'first';
    a1.note = 'second';
    b0.note = 'other region';
    shadowed.note = 'in shadow';

    const saved = JSON.parse(JSON.stringify(captureInteractionState(document.body))) as unknown;
    document.body.innerHTML = '';

    const after = fields(render());
    expect(restoreInteractionState(document.body, saved)).toBe(4);
    expect(after.map((field) => field.note)).toEqual([
      'first',
      'second',
      'other region',
      'in shadow',
    ]);
  });

  it('keys components by origin region, tag, and ordinal', () => {
    const [, a1, , shadowed] = fields(render());
    if (a1 === undefined || shadowed === undefined) {
      throw new Error('expected fields');
    }
    a1.note = 'x';
    shadowed.note = 'y';

    expect(captureInteractionState(document.body)).toEqual({
      version: 1,
      components: [
        { region: '$.a', tag: 'note-field', index: 1, state: { note: 'x' } },
        { region: '$.b', tag: 'note-field', index: 1, state: { note: 'y' } },
      ],
    });
  });

  it('ignores unmatched entries and restores nothing from an invalid snapshot', () => {
    const [a0] = fields(render());
    const entry = { region: '$.a', tag: 'note-field', index: 0, state: { note: 'kept' } };

    expect(restoreInteractionState(document.body, { version: 2, components: [entry] })).toBe(0);
    expect(restoreInteractionState(document.body, 'nonsense')).toBe(0);
    expect(
      restoreInteractionState(document.body, {
        version: 1,
        components: [{ ...entry, state: { note: Number.NaN } }],
      }),
    ).toBe(0);
    expect(a0?.note).toBeUndefined();

    const unmatched = { ...entry, region: '$.missing' };
    expect(
      restoreInteractionState(document.body, { version: 1, components: [unmatched, entry] }),
    ).toBe(1);
    expect(a0?.note).toBe('kept');
  });
});
