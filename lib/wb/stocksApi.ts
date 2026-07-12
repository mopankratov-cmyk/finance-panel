export const WB_WAREHOUSE_STOCKS_URL =
  "https://seller-analytics-api.wildberries.ru/api/analytics/v1/stocks-report/wb-warehouses";

export interface WbWarehouseStock {
  nmId: number;
  chrtId: number;
  warehouseId: number;
  warehouseName: string;
  regionName: string;
  quantity: number;
  inWayToClient: number;
  inWayFromClient: number;
}

interface WbWarehouseStocksResponse {
  data?: {
    items?: WbWarehouseStock[];
  };
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface WbWarehouseStockPagesOptions {
  token: string;
  nmIds?: number[] | null;
  limit?: number;
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  minIntervalMs?: number;
}

export class WbStocksApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "WbStocksApiError";
  }
}

function retryDelayMs(response: Response, fallbackMs: number): number {
  const raw = response.headers.get("retry-after");
  const seconds = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : fallbackMs;
}

function chunks<T>(values: T[], size: number): T[][] {
  if (!values.length) return [[]];
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

export async function* wbWarehouseStockPages(
  options: WbWarehouseStockPagesOptions,
): AsyncGenerator<WbWarehouseStock[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const minIntervalMs = options.minIntervalMs ?? 20_000;
  const limit = Math.min(Math.max(options.limit ?? 250_000, 1), 250_000);
  const nmIdBatches = chunks(
    [...new Set((options.nmIds ?? []).filter((nm) => Number.isInteger(nm) && nm > 0))],
    1000,
  );
  let requestsMade = 0;

  for (const nmIds of nmIdBatches) {
    let offset = 0;
    while (true) {
      if (requestsMade > 0 && minIntervalMs > 0) await sleep(minIntervalMs);

      const body = JSON.stringify({ nmIds, chrtIds: [], limit, offset });
      let response = await fetchImpl(WB_WAREHOUSE_STOCKS_URL, {
        method: "POST",
        headers: {
          Authorization: options.token,
          "Content-Type": "application/json",
        },
        body,
        cache: "no-store",
      });
      requestsMade++;

      // WB считает лимит по аккаунту продавца. Один повтор помогает, если ручной
      // запуск пересёкся с cron или предыдущей страницей отчёта.
      if (response.status === 429) {
        await sleep(retryDelayMs(response, minIntervalMs));
        response = await fetchImpl(WB_WAREHOUSE_STOCKS_URL, {
          method: "POST",
          headers: {
            Authorization: options.token,
            "Content-Type": "application/json",
          },
          body,
          cache: "no-store",
        });
        requestsMade++;
      }

      if (!response.ok) {
        const message = (await response.text()).slice(0, 240);
        throw new WbStocksApiError(response.status, message || response.statusText);
      }

      const payload = (await response.json()) as WbWarehouseStocksResponse;
      const items = payload.data?.items;
      if (!Array.isArray(items)) {
        throw new WbStocksApiError(200, "WB вернул некорректный ответ остатков: data.items отсутствует");
      }

      yield items;
      if (items.length < limit) break;
      offset += items.length;
    }
  }
}
