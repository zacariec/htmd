import { baseCatalog, createHost, sameOriginMediaPolicy } from '@htmdjs/contracts';
import type { DataRequest, HtmdHost, TableBatch, UrlRequest } from '@htmdjs/contracts';

const COLUMNS: readonly string[] = ['week', 'revenue', 'orders'];
const BATCH_SIZE = 4;
const BATCH_DELAY_MS = 400;

/** Weekly Q4 sales, w40–w52, served in-page instead of from a backend. */
const Q4_SALES: readonly Readonly<Record<string, unknown>>[] = [
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

const DATASETS: Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>> = {
  '/api/sales/q4': Q4_SALES,
};

/** Media follows the default policy; data only for the playground's own datasets. */
function authorizeUrl(request: UrlRequest): boolean {
  if (request.purpose !== 'data') {
    return sameOriginMediaPolicy(request);
  }
  return (
    request.url.origin === window.location.origin && DATASETS[request.url.pathname] !== undefined
  );
}

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
  const rows = DATASETS[request.url.pathname];
  if (rows === undefined) {
    throw new Error(`no playground dataset for ${request.url.pathname}`);
  }
  for (let start = 0; start < rows.length; start += BATCH_SIZE) {
    if (start > 0) {
      await delay(BATCH_DELAY_MS, request.signal);
    }
    const batch = rows.slice(start, start + BATCH_SIZE);
    yield start === 0 ? { columns: [...COLUMNS], rows: batch } : { rows: batch };
  }
}

/** Module-scoped so every render sees the same host identity. */
export const playgroundHost: HtmdHost = createHost({
  components: baseCatalog,
  authorizeUrl,
  loadData,
});
