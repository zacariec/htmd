import { baseCatalog, createHost } from '@htmdjs/contracts';
import { setHtmdElementsLogSink } from '@htmdjs/elements';
import { renderHtmdSource } from '@htmdjs/renderer';
import { act, cleanup, render } from '@testing-library/react';
import { type Root, hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { HtmdDoc } from '../src/htmd-doc.js';

beforeAll(() => {
  setHtmdElementsLogSink({ warn: () => {}, error: () => {} });
});

afterEach(() => cleanup());

describe('<HtmdDoc>', () => {
  it('renders markdown as HTML', () => {
    const { container } = render(<HtmdDoc source="# Hello" />);
    expect(container.querySelector('h1')?.textContent).toBe('Hello');
  });

  it('materializes custom elements with attributes', () => {
    const { container } = render(
      <HtmdDoc source={`<image-card src="/x.png" alt="x" width="4" height="3"/>`} />,
    );
    const card = container.querySelector('image-card');
    expect(card).not.toBeNull();
    expect(card?.getAttribute('src')).toBe('/x.png');
  });

  it('re-renders when source changes', () => {
    const { container, rerender } = render(<HtmdDoc source="# One" />);
    expect(container.querySelector('h1')?.textContent).toBe('One');

    rerender(<HtmdDoc source="# Two" />);
    expect(container.querySelector('h1')?.textContent).toBe('Two');
  });

  it('surfaces diagnostics via onDiagnostics', () => {
    const spy = vi.fn();
    render(<HtmdDoc source="<script>alert(1)</script>" onDiagnostics={spy} />);
    expect(spy).toHaveBeenCalled();
    const diagnostics = spy.mock.calls[0]?.[0] as ReadonlyArray<{ code: string }>;
    expect(diagnostics.length).toBeGreaterThanOrEqual(1);
  });

  it('renders only components in the host catalog and reports contract diagnostics', () => {
    const host = createHost({ components: baseCatalog.without('image-card') });
    const spy = vi.fn();
    const { container } = render(
      <HtmdDoc source={`<image-card src="/x.png" alt="x"/>`} host={host} onDiagnostics={spy} />,
    );

    expect(container.querySelector('image-card')).toBeNull();
    expect(container.querySelector('[data-htmd-fallback="image-card"]')).not.toBeNull();
    expect(spy).toHaveBeenLastCalledWith([
      expect.objectContaining({ code: 'unknown-component', tag: 'image-card' }),
    ]);
  });

  it('forwards HTML attributes to the container div', () => {
    const { container } = render(<HtmdDoc source="text" className="doc" data-testid="host" />);
    const host = container.firstChild as HTMLElement;
    expect(host.getAttribute('class')).toBe('doc');
    expect(host.getAttribute('data-testid')).toBe('host');
  });
});

describe('<HtmdDoc> server rendering', () => {
  const source = [
    '# Report',
    '',
    'Some **bold** text.',
    '',
    '<image-card src="/x.png" alt="x"></image-card>',
    '',
    '<chat-message author="agent">',
    '',
    'Inside *a* message.',
    '',
    '</chat-message>',
  ].join('\n');

  let root: Root | undefined;
  let mounted: HTMLElement | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    mounted?.remove();
    root = undefined;
    mounted = undefined;
  });

  /** Hydrates server markup for `<HtmdDoc source={source}/>` in a connected container. */
  async function hydrate(onRecoverableError: () => void): Promise<HTMLElement> {
    const container = document.createElement('div');
    container.innerHTML = renderToString(<HtmdDoc source={source} />);
    document.body.append(container);
    mounted = container;
    await act(async () => {
      root = hydrateRoot(container, <HtmdDoc source={source} />, { onRecoverableError });
    });
    return container;
  }

  it('renders the document markup on the server', () => {
    const html = renderToString(<HtmdDoc source={source} className="doc" />);

    expect(html).toMatch(/^<div class="doc">/);
    expect(html).toContain('<h1>Report</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<image-card src="/x.png" alt="x"></image-card>');
    expect(html).toMatch(/<chat-message author="agent"><p>Inside <em>a<\/em> message.<\/p>/);
  });

  it('hydrates without recoverable errors and materializes the same content', async () => {
    const onRecoverableError = vi.fn();
    const container = await hydrate(onRecoverableError);

    const expected = document.createElement('div');
    document.body.append(expected);
    renderHtmdSource(expected, source);
    // Let both trees' element updates settle before comparing.
    const settled = Promise.withResolvers<void>();
    setTimeout(settled.resolve, 0);
    await settled.promise;

    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(container.firstElementChild?.innerHTML).toBe(expected.innerHTML);
    expected.remove();
  });

  it('updates after hydration without React resetting materialized elements', async () => {
    const container = await hydrate(vi.fn());
    const card = container.querySelector('image-card');
    expect(card).not.toBeNull();

    await act(async () => {
      root?.render(<HtmdDoc source={source.replace('# Report', '# Revised')} />);
    });

    expect(container.querySelector('h1')?.textContent).toBe('Revised');
    // The unchanged block keeps its live element.
    expect(container.querySelector('image-card')).toBe(card);
  });
});
