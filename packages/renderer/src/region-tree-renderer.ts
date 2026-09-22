import { Parser, isCustomElementTag } from '@htmdjs/parser';
import type { Diagnostic } from '@htmdjs/parser';
import { safeParseWireEvent } from '@htmdjs/wire';
import type {
  DocDoneEvent,
  DocOpenEvent,
  HtmdErrorEvent,
  RegionDoneEvent,
  RegionEvent,
  RegionReplaceEvent,
  StreamEvent,
  WireEvent,
} from '@htmdjs/wire';

import { applySafeAttrs, materializeInto } from './materialize.js';
import { RendererEvents } from './renderer-events.js';
import type {
  DocDoneDetail,
  DocOpenDetail,
  RegionCreatedDetail,
  RegionDoneDetail,
  RegionReplacedDetail,
  RegionUpdatedDetail,
  RendererErrorDetail,
} from './renderer-events.js';

/**
 * `RegionTreeRenderer` — the streaming materializer.
 *
 * Consumes `@htmdjs/wire` events and maintains a live DOM tree under a root
 * element. Each region is an addressable element (`data-htmd-region="$.path"`);
 * streamed `.htmd` chunks accumulate per region and re-materialize only that
 * region's content — never the whole document.
 *
 * - Region ids are `$`-rooted dot paths. A region attaches to its explicit
 *   `parent` when given, otherwise to the region at its path prefix
 *   (`$.a.b` → `$.a`), creating implicit `div` regions for missing links.
 * - Events are validated with Zod on entry; malformed events surface as
 *   `RendererEvents.Error`, never as a crash.
 * - `seq` is monotonic per document. Events at or below the last applied
 *   `seq` are skipped, which makes resume-with-replay idempotent.
 * - Only schema version 0.1 is supported. Fragment-only streams may omit
 *   `doc-open`; otherwise `doc-done` must match the opened document id.
 * - `region-done` finalizes its actual subtree, not its id prefix. Appends
 *   and new descendants are then rejected. Replacement reopens a region
 *   only while all its ancestors remain open.
 * - `doc-done` finalizes every region; it and fatal errors close the document.
 *   New events require `reset`, while accepted-sequence replays stay no-ops.
 * - Incomplete streamed syntax is exposed via `data-htmd-pending`; completion
 *   reparses with final semantics and reports diagnostics via RegionUpdated.
 *
 * Lifecycle hooks dispatch from the renderer itself (`EventTarget`).
 */

const ROOT_REGION_ID = '$';
const REGION_ATTR = 'data-htmd-region';
const CONTENT_ATTR = 'data-htmd-content';
const DONE_ATTR = 'data-htmd-done';
const PENDING_ATTR = 'data-htmd-pending';

/** Non-custom tags a `region` event may materialize as. Anything else falls
 * back to `div` with a recoverable error. */
const SAFE_NATIVE_REGION_TAGS: ReadonlySet<string> = new Set(['div', 'span', 'section', 'article']);

interface RegionState {
  readonly id: string;
  readonly element: HTMLElement;
  readonly parentId: string | undefined;
  contentElement: HTMLElement | undefined;
  buffer: string;
  done: boolean;
}

export class RegionTreeRenderer extends EventTarget {
  private readonly regions = new Map<string, RegionState>();

  private lastSeq: number = -1;

  private docId: string | undefined = undefined;

  private closed = false;

  public constructor(private readonly root: HTMLElement) {
    super();
    this.registerRoot();
  }

  /** The highest `seq` applied so far (-1 before the first event). Send this
   * as the resume cursor when reconnecting. */
  public get lastAppliedSeq(): number {
    return this.lastSeq;
  }

  /** The element for a region id, if the region exists. */
  public regionElement(id: string): Element | undefined {
    return this.regions.get(id)?.element;
  }

  /** Every known region id, root included. */
  public regionIds(): readonly string[] {
    return [...this.regions.keys()];
  }

  /** Clears the tree and all state. Use before rendering a new document. */
  public reset(): void {
    this.root.replaceChildren();
    this.root.removeAttribute(DONE_ATTR);
    this.root.removeAttribute(PENDING_ATTR);
    this.regions.clear();
    this.registerRoot();
    this.lastSeq = -1;
    this.docId = undefined;
    this.closed = false;
  }

  /**
   * Validates and applies one wire event. Returns true when the event was
   * accepted (including idempotent replays), false for invalid schema or lifecycle.
   */
  public apply(raw: unknown): boolean {
    const parsed = safeParseWireEvent(raw);
    if (!parsed.success) {
      this.emit<RendererErrorDetail>(RendererEvents.Error, {
        message: `invalid wire event: ${parsed.error.message}`,
        regionId: undefined,
        recoverable: true,
      });
      return false;
    }

    const event = parsed.data;
    if (event.seq <= this.lastSeq) {
      return true;
    }
    const rejection = this.validateLifecycle(event);
    if (rejection !== undefined) {
      this.emit<RendererErrorDetail>(RendererEvents.Error, {
        message: rejection,
        regionId:
          event.type === 'stream'
            ? event.target
            : event.type === 'region' ||
                event.type === 'region-done' ||
                event.type === 'region-replace'
              ? event.id
              : undefined,
        recoverable: true,
      });
      return false;
    }
    this.lastSeq = event.seq;

    this.handle(event);
    return true;
  }

  /** Applies a batch of events. Returns how many were accepted. */
  public applyAll(events: Iterable<unknown>): number {
    let accepted = 0;
    for (const event of events) {
      if (this.apply(event)) {
        accepted += 1;
      }
    }
    return accepted;
  }

  private validateLifecycle(event: WireEvent): string | undefined {
    if (this.closed) {
      return 'document is closed; reset before applying new events';
    }
    if (event.type === 'doc-open') {
      if (event.schemaVersion !== '0.1') {
        return `unsupported schema version "${event.schemaVersion}"; expected "0.1"`;
      }
      return this.lastSeq === -1
        ? undefined
        : 'document already started; reset before opening another';
    }
    if (event.type === 'doc-done') {
      return this.docId !== undefined && this.docId !== event.id
        ? `document completion id "${event.id}" does not match "${this.docId}"`
        : undefined;
    }
    if (event.type === 'error') {
      return undefined;
    }
    if (event.type === 'region') {
      let parentId: string | undefined =
        event.parent ?? (event.id === ROOT_REGION_ID ? undefined : parentPathOf(event.id));
      while (parentId !== undefined) {
        if (parentId === event.id) {
          return `region "${event.id}" cannot be its own ancestor`;
        }
        parentId = this.parentIdOf(parentId);
      }
      if (this.regions.has(event.id)) {
        return undefined;
      }
      return this.closedAncestor(event.parent ?? parentPathOf(event.id));
    }
    if (event.type === 'region-done') {
      return this.regions.has(event.id) ? undefined : this.closedAncestor(event.id);
    }
    const id = event.type === 'stream' ? event.target : event.id;
    return this.closedAncestor(event.type === 'region-replace' ? this.parentIdOf(id) : id);
  }

  private parentIdOf(id: string): string | undefined {
    if (id === ROOT_REGION_ID) {
      return undefined;
    }
    return this.regions.get(id)?.parentId ?? parentPathOf(id);
  }

  private closedAncestor(id: string | undefined): string | undefined {
    let ancestor = id;
    while (ancestor !== undefined) {
      if (this.regions.get(ancestor)?.done === true) {
        return `region "${ancestor}" is complete; replace it before adding content`;
      }
      ancestor = this.parentIdOf(ancestor);
    }
    return undefined;
  }

  private handle(event: WireEvent): void {
    switch (event.type) {
      case 'doc-open':
        this.handleDocOpen(event);
        return;
      case 'region':
        this.handleRegion(event);
        return;
      case 'stream':
        this.handleStream(event);
        return;
      case 'region-done':
        this.handleRegionDone(event);
        return;
      case 'region-replace':
        this.handleRegionReplace(event);
        return;
      case 'doc-done':
        this.handleDocDone(event);
        return;
      case 'error':
        this.handleError(event);
        return;
      default:
        assertNever(event);
    }
  }

  private handleDocOpen(event: DocOpenEvent): void {
    this.docId = event.id;
    this.emit<DocOpenDetail>(RendererEvents.DocOpen, {
      docId: event.id,
      schemaVersion: event.schemaVersion,
    });
  }

  private handleRegion(event: RegionEvent): void {
    if (this.regions.has(event.id)) {
      return;
    }

    const parent =
      event.parent === undefined
        ? this.ensureRegion(parentPathOf(event.id))
        : this.ensureRegion(event.parent);

    const element = this.createRegionElement(event.tag, event.attrs ?? {}, event.id);
    parent.element.appendChild(element);

    const state: RegionState = {
      id: event.id,
      element,
      parentId: parent.id,
      contentElement: undefined,
      buffer: '',
      done: false,
    };
    this.regions.set(event.id, state);

    this.emit<RegionCreatedDetail>(RendererEvents.RegionCreated, { id: event.id, element });
  }

  private handleStream(event: StreamEvent): void {
    const region = this.ensureRegion(event.target);
    region.buffer += event.chunk;
    this.renderAndNotify(region);
  }

  private handleRegionDone(event: RegionDoneEvent): void {
    const region = this.ensureRegion(event.id);
    for (const state of this.regions.values()) {
      if (region.element.contains(state.element)) {
        this.finalizeRegion(state);
      }
    }
  }

  private handleRegionReplace(event: RegionReplaceEvent): void {
    const region = this.ensureRegion(event.id);

    for (const [id, child] of this.regions) {
      if (child !== region && region.element.contains(child.element)) {
        this.regions.delete(id);
      }
    }

    region.element.replaceChildren();
    region.element.removeAttribute(DONE_ATTR);
    region.contentElement = undefined;
    region.buffer = event.body;
    region.done = false;
    this.renderAndNotify(region);

    this.emit<RegionReplacedDetail>(RendererEvents.RegionReplaced, {
      id: region.id,
      element: region.element,
    });
  }

  private handleDocDone(event: DocDoneEvent): void {
    this.closed = true;
    this.docId = event.id;
    for (const region of this.regions.values()) {
      this.finalizeRegion(region);
    }
    this.emit<DocDoneDetail>(RendererEvents.DocDone, { docId: event.id });
  }

  private handleError(event: HtmdErrorEvent): void {
    if (!event.recoverable) {
      this.closed = true;
    }
    this.emit<RendererErrorDetail>(RendererEvents.Error, {
      message: event.message,
      regionId: event.region,
      recoverable: event.recoverable,
    });
  }

  /**
   * Returns the region for `id`, creating it (and any missing ancestors) as
   * implicit `div` regions. Streaming into an undeclared sub-path — the
   * `$.msg.body` idiom — lands here.
   */
  private ensureRegion(id: string): RegionState {
    const existing = this.regions.get(id);
    if (existing !== undefined) {
      return existing;
    }

    const parent = this.ensureRegion(parentPathOf(id));
    const element = this.root.ownerDocument.createElement('div');
    element.setAttribute(REGION_ATTR, id);
    parent.element.appendChild(element);

    const state: RegionState = {
      id,
      element,
      parentId: parent.id,
      contentElement: undefined,
      buffer: '',
      done: false,
    };
    this.regions.set(id, state);

    this.emit<RegionCreatedDetail>(RendererEvents.RegionCreated, { id, element });
    return state;
  }

  private createRegionElement(
    tag: string,
    attrs: Readonly<Record<string, string>>,
    id: string,
  ): HTMLElement {
    const safe = isCustomElementTag(tag) || SAFE_NATIVE_REGION_TAGS.has(tag);
    if (!safe) {
      this.emit<RendererErrorDetail>(RendererEvents.Error, {
        message: `region tag "${tag}" is not allowed; using <div>`,
        regionId: id,
        recoverable: true,
      });
    }

    const element = this.root.ownerDocument.createElement(safe ? tag : 'div');
    applySafeAttrs(element, attrs);
    element.setAttribute(REGION_ATTR, id);
    return element;
  }

  private renderAndNotify(region: RegionState, final = false): void {
    const diagnostics = this.renderRegionContent(region, final);
    this.emit<RegionUpdatedDetail>(RendererEvents.RegionUpdated, {
      id: region.id,
      element: region.element,
      diagnostics,
    });
  }

  private finalizeRegion(region: RegionState): void {
    if (region.done) {
      return;
    }
    region.done = true;
    region.element.setAttribute(DONE_ATTR, '');
    if (region.buffer !== '' || region.contentElement !== undefined) {
      this.renderAndNotify(region, true);
    }
    this.emit<RegionDoneDetail>(RendererEvents.RegionDone, {
      id: region.id,
      element: region.element,
    });
  }

  /**
   * Re-parses the region's accumulated buffer and re-materializes its content
   * container. Child regions are siblings of the content container, so they
   * survive every re-render.
   */
  private renderRegionContent(region: RegionState, final: boolean): ReadonlyArray<Diagnostic> {
    if (region.contentElement === undefined) {
      const content = this.root.ownerDocument.createElement('div');
      content.setAttribute(CONTENT_ATTR, '');
      region.element.prepend(content);
      region.contentElement = content;
    }

    const result = Parser.getInstance().parse(region.buffer, { streaming: !final });
    materializeInto(region.contentElement, result.document.nodes, { streaming: !final });
    region.element.toggleAttribute(PENDING_ATTR, result.pending);
    return result.diagnostics;
  }

  private registerRoot(): void {
    this.root.setAttribute(REGION_ATTR, ROOT_REGION_ID);
    this.regions.set(ROOT_REGION_ID, {
      id: ROOT_REGION_ID,
      element: this.root,
      parentId: undefined,
      contentElement: undefined,
      buffer: '',
      done: false,
    });
  }

  private emit<T>(type: RendererEvents, detail: T): void {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

/** `$.a.b` → `$.a`; single-segment paths and `$` itself parent to the root. */
function parentPathOf(id: string): string {
  const lastDot = id.lastIndexOf('.');
  if (lastDot <= 0) {
    return ROOT_REGION_ID;
  }
  return id.slice(0, lastDot);
}

function assertNever(value: never): never {
  throw new Error(`unhandled wire event: ${JSON.stringify(value)}`);
}
