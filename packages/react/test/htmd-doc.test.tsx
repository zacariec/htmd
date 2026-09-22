import { cleanup, render } from '@testing-library/react';
import { setHtmdElementsLogSink } from '@zacariec/htmd-elements';
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

  it('forwards HTML attributes to the container div', () => {
    const { container } = render(<HtmdDoc source="text" className="doc" data-testid="host" />);
    const host = container.firstChild as HTMLElement;
    expect(host.getAttribute('class')).toBe('doc');
    expect(host.getAttribute('data-testid')).toBe('host');
  });
});
