import { baseCatalog } from './base.js';
import type { ComponentCatalog } from './catalog.js';
import { sanitizeUrl } from './sanitize-url.js';
import type { UrlPurpose } from './types.js';

/**
 * The host decides what a document may use: which components exist, which
 * URLs components may load or expose, and how component data is loaded.
 *
 * Components obtain the host through a DOM request event, so the same element
 * works under the renderer, inside another component's shadow tree, or
 * standalone (where `defaultHost` applies).
 */

export interface UrlRequest {
  readonly url: URL;
  readonly purpose: UrlPurpose;
  /** Requesting component tag. */
  readonly component: string;
  readonly element: Element;
}

export interface DataRequest {
  readonly url: URL;
  readonly component: string;
  readonly element: Element;
  /** Aborted when the component is removed or its source changes. */
  readonly signal: AbortSignal;
}

/**
 * Returns a complete payload, or an async iterable of payload batches for
 * components whose contract supports progressive data.
 */
export type DataLoader = (request: DataRequest) => Promise<unknown> | AsyncIterable<unknown>;

export interface HtmdHost {
  readonly components: ComponentCatalog;
  readonly authorizeUrl: (request: UrlRequest) => boolean;
  /** Absent: components fetch authorized `data` URLs as JSON. */
  readonly loadData: DataLoader | undefined;
}

export interface HtmdHostOptions {
  readonly components: ComponentCatalog;
  readonly authorizeUrl?: (request: UrlRequest) => boolean;
  readonly loadData?: DataLoader;
}

/**
 * Default URL policy: same-origin images, links, and downloads. Data is never
 * authorized by default — a model-provided URL is not permission to fetch it.
 */
export function sameOriginMediaPolicy(request: UrlRequest): boolean {
  if (request.purpose === 'data') {
    return false;
  }
  return request.url.origin === new URL(request.element.ownerDocument.baseURI).origin;
}

export function createHost(options: HtmdHostOptions): HtmdHost {
  return {
    components: options.components,
    authorizeUrl: options.authorizeUrl ?? sameOriginMediaPolicy,
    loadData: options.loadData,
  };
}

/** Base components with the default URL policy and no data loader. */
export const defaultHost: HtmdHost = createHost({ components: baseCatalog });

export const HOST_REQUEST_EVENT = 'htmd-host-request';

interface HostRequestDetail {
  host: HtmdHost | undefined;
}

const providers = new WeakMap<EventTarget, HtmdHost>();
const listening = new WeakSet<EventTarget>();

/**
 * Makes `host` the answer for requests from descendants of `target`. The
 * nearest provider wins; providing again replaces the previous host.
 */
export function provideHtmdHost(target: EventTarget, host: HtmdHost): void {
  providers.set(target, host);
  if (listening.has(target)) {
    return;
  }
  listening.add(target);
  target.addEventListener(HOST_REQUEST_EVENT, (event) => {
    const provided = providers.get(target);
    const detail = (event as CustomEvent<HostRequestDetail>).detail;
    if (provided === undefined || detail.host !== undefined) {
      return;
    }
    detail.host = provided;
    event.stopPropagation();
  });
}

export function revokeHtmdHost(target: EventTarget): void {
  providers.delete(target);
}

/**
 * The host governing `element`, or `fallback` when no ancestor provides one.
 * Call when an effect is about to happen, not at construction: disconnected
 * elements cannot reach their provider.
 */
export function requestHtmdHost(element: Element, fallback: HtmdHost = defaultHost): HtmdHost {
  const detail: HostRequestDetail = { host: undefined };
  element.dispatchEvent(
    new CustomEvent<HostRequestDetail>(HOST_REQUEST_EVENT, {
      detail,
      bubbles: true,
      composed: true,
    }),
  );
  return detail.host ?? fallback;
}

const NETWORK_PURPOSES: ReadonlySet<UrlPurpose> = new Set(['data', 'image', 'download']);

/**
 * The single URL gate for components: scheme allowlist, resolution against the
 * document base, network schemes for loads, then host authorization. Returns
 * the URL to use, or undefined when it must not be loaded or exposed.
 */
export function authorizeComponentUrl(
  element: Element,
  raw: string,
  purpose: UrlPurpose,
  host: HtmdHost,
): URL | undefined {
  const cleaned = sanitizeUrl(raw);
  if (cleaned === undefined) {
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(cleaned, element.ownerDocument.baseURI);
  } catch {
    return undefined;
  }
  if (NETWORK_PURPOSES.has(purpose) && url.protocol !== 'http:' && url.protocol !== 'https:') {
    return undefined;
  }
  return host.authorizeUrl({ url, purpose, component: element.localName, element })
    ? url
    : undefined;
}
