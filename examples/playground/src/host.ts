import { baseCatalog, createHost, sameOriginMediaPolicy } from '@htmdjs/contracts';
import type { ComponentCatalog, DataRequest, HtmdHost, TableBatch } from '@htmdjs/contracts';

type Row = Readonly<Record<string, unknown>>;

interface Dataset {
  readonly rows: readonly Row[];
  /** Throw after this many batches, to demonstrate an interrupted table. */
  readonly failAfterBatches?: number;
}

const COLUMNS: readonly string[] = ['week', 'revenue', 'orders'];
const BATCH_SIZE = 4;
const BATCH_DELAY_MS = 400;

/** Weekly Q4 sales, w40–w52, served in-page instead of from a backend. */
const Q4_SALES: readonly Row[] = [
  { week: 'w40', revenue: 182_400, orders: 1_204 },
  { week: 'w41', revenue: 187_950, orders: 1_236 },
  { week: 'w42', revenue: 191_300, orders: 1_251 },
  { week: 'w43', revenue: 189_800, orders: 1_240 },
  { week: 'w44', revenue: 196_700, orders: 1_288 },
  { week: 'w45', revenue: 201_150, orders: 1_312 },
  { week: 'w46', revenue: 204_900, orders: 1_335 },
  { week: 'w47', revenue: 229_600, orders: 1_497 },
  { week: 'w48', revenue: 214_300, orders: 1_401 },
  { week: 'w49', revenue: 171_050, orders: 1_122 },
  { week: 'w50', revenue: 208_750, orders: 1_366 },
  { week: 'w51', revenue: 236_200, orders: 1_540 },
  { week: 'w52', revenue: 219_400, orders: 1_433 },
];

const DATASETS: Readonly<Record<string, Dataset>> = {
  '/api/sales/q4': { rows: Q4_SALES },
  '/api/sales/flaky': { rows: Q4_SALES, failAfterBatches: 2 },
};

function delay(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

/** Streams a dataset as progressive table batches; the first batch carries the columns. */
async function* loadData(request: DataRequest): AsyncGenerator<TableBatch> {
  const dataset = DATASETS[request.url.pathname];
  if (dataset === undefined) {
    throw new Error(`no playground dataset for ${request.url.pathname}`);
  }
  for (let batch = 0; batch * BATCH_SIZE < dataset.rows.length; batch += 1) {
    if (batch > 0) {
      await delay(BATCH_DELAY_MS, request.signal);
    }
    if (batch === dataset.failAfterBatches) {
      throw new Error('the playground source dropped the connection');
    }
    const rows = dataset.rows.slice(batch * BATCH_SIZE, (batch + 1) * BATCH_SIZE);
    yield batch === 0 ? { columns: [...COLUMNS], rows } : { rows };
  }
}

/** What the host lets a document do beyond rendering its catalog. */
export interface PlaygroundPermissions {
  /** Load the playground's own datasets. Other data URLs are always refused. */
  readonly data: boolean;
  /** Load same-origin images. */
  readonly images: boolean;
  /** Expose same-origin links and downloads. */
  readonly links: boolean;
}

export function createPlaygroundHost(
  components: ComponentCatalog,
  permissions: PlaygroundPermissions,
): HtmdHost {
  return createHost({
    components,
    authorizeUrl: (request) => {
      switch (request.purpose) {
        case 'data':
          return (
            permissions.data &&
            request.url.origin === window.location.origin &&
            DATASETS[request.url.pathname] !== undefined
          );
        case 'image':
          return permissions.images && sameOriginMediaPolicy(request);
        default:
          return permissions.links && sameOriginMediaPolicy(request);
      }
    },
    loadData,
  });
}

/** Module-scoped so every render sees the same host identity. */
export const playgroundHost: HtmdHost = createPlaygroundHost(baseCatalog, {
  data: true,
  images: true,
  links: true,
});
