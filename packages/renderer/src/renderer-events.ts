import type { Diagnostic } from '@zacariec/htmd-parser';

/**
 * Lifecycle events dispatched by `RegionTreeRenderer` (on the renderer
 * instance — it extends `EventTarget`).
 */
export enum RendererEvents {
  DocOpen = 'htmd-doc-open',
  RegionCreated = 'htmd-region-created',
  RegionUpdated = 'htmd-region-updated',
  RegionDone = 'htmd-region-done',
  RegionReplaced = 'htmd-region-replaced',
  DocDone = 'htmd-doc-done',
  Error = 'htmd-renderer-error',
}

export interface DocOpenDetail {
  readonly docId: string;
  readonly schemaVersion: string;
}

export interface RegionCreatedDetail {
  readonly id: string;
  readonly element: Element;
}

export interface RegionUpdatedDetail {
  readonly id: string;
  readonly element: Element;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
}

export interface RegionDoneDetail {
  readonly id: string;
  readonly element: Element;
}

export interface RegionReplacedDetail {
  readonly id: string;
  readonly element: Element;
}

export interface DocDoneDetail {
  readonly docId: string;
}

export interface RendererErrorDetail {
  readonly message: string;
  readonly regionId: string | undefined;
  readonly recoverable: boolean;
}
