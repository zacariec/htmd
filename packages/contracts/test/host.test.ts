import { describe, expect, it } from 'vitest';

import { baseCatalog } from '../src/base.js';
import {
  authorizeComponentUrl,
  createHost,
  defaultHost,
  provideHtmdHost,
  requestHtmdHost,
  revokeHtmdHost,
} from '../src/host.js';

describe('host provision', () => {
  it('answers with the nearest provider, crossing shadow roots, and honors replacement', () => {
    const outer = document.createElement('div');
    const shadowHost = document.createElement('div');
    outer.append(shadowHost);
    document.body.append(outer);
    const inner = shadowHost.attachShadow({ mode: 'open' });
    const component = document.createElement('data-table');
    inner.append(component);

    const outerHost = createHost({ components: baseCatalog });
    const nearHost = createHost({ components: baseCatalog.without('data-table') });
    provideHtmdHost(outer, outerHost);
    expect(requestHtmdHost(component)).toBe(outerHost);

    provideHtmdHost(shadowHost, nearHost);
    expect(requestHtmdHost(component)).toBe(nearHost);

    const replacement = createHost({ components: baseCatalog });
    provideHtmdHost(shadowHost, replacement);
    expect(requestHtmdHost(component)).toBe(replacement);

    revokeHtmdHost(shadowHost);
    expect(requestHtmdHost(component)).toBe(outerHost);
    document.body.append(component);
    expect(requestHtmdHost(component)).toBe(defaultHost);
    outer.remove();
    component.remove();
  });
});

describe('authorizeComponentUrl', () => {
  const element = document.createElement('image-card');

  it('denies data by default, even same-origin, and allows same-origin media', () => {
    expect(authorizeComponentUrl(element, '/api/rows', 'data', defaultHost)).toBeUndefined();
    expect(authorizeComponentUrl(element, '/a.png', 'image', defaultHost)?.pathname).toBe('/a.png');
    expect(
      authorizeComponentUrl(element, 'https://tracker.example/p.gif', 'image', defaultHost),
    ).toBeUndefined();
  });

  it('rejects unsafe or non-network schemes before consulting the host', () => {
    const permissive = createHost({ components: baseCatalog, authorizeUrl: () => true });
    expect(authorizeComponentUrl(element, 'java\tscript:alert(1)', 'link', permissive)).toBe(
      undefined,
    );
    expect(authorizeComponentUrl(element, 'mailto:a@example.com', 'image', permissive)).toBe(
      undefined,
    );
    expect(authorizeComponentUrl(element, 'mailto:a@example.com', 'link', permissive)?.href).toBe(
      'mailto:a@example.com',
    );
  });
});
