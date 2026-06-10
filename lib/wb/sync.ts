import { getCached, setCache } from "./cache";
import { wbFetch } from "./fetch";
import {
  SYNC_META_KEY,
  SALES_LIMIT,
  adStatsCacheKey,
  adsCacheKey,
  allSyncChunks,
  chunkRange,
  chunksForRange,
  ordersCacheKey,
  salesCacheKey,
  stocksCacheKey,
  stocksDateFrom,
} from "./keys";
import { extractAdvertIds } from "./types";
import type {
  WbAdStat,
  WbAdvertsResponse,
  WbOrder,
  WbReportRow,
  WbStock,
} from "./types";

const FORCE = { skipCacheRead: true };

export interface WbSyncOptions {
  /** Полная синхронизация всех чанков (cron) */
  full?: boolean;
  /** Диапазон UI — синхронизируем только пересекающиеся 7-дневные чанки */
  dateFrom?: string;
  dateTo?: string;
}

function filterOrdersInChunk(
  orders: WbOrder[],
  dateFrom: string,
  dateTo: string,
): WbOrder[] {
  return orders.filter((o) => {
    const d = (o.date ?? "").slice(0, 10);
    return d >= dateFrom && d <= dateTo;
  });
}

async function resolveAdvertIds(): Promise<number[]> {
  const cached = await getCached<WbAdvertsResponse>(adsCacheKey());
  if (cached) return extractAdvertIds(cached);

  const ads = await wbFetch<WbAdvertsResponse>(
    "https://advert-api.wildberries.ru/api/advert/v2/adverts",
    { method: "GET" },
    ["ads-v2"],
    FORCE,
  );
  if (ads.data) {
    await setCache(adsCacheKey(), ads.data);
    return extractAdvertIds(ads.data);
  }
  return [];
}

async function syncAds(): Promise<number[]> {
  const ads = await wbFetch<WbAdvertsResponse>(
    "https://advert-api.wildberries.ru/api/advert/v2/adverts",
    { method: "GET" },
    ["ads-v2"],
    FORCE,
  );
  if (ads.data) {
    await setCache(adsCacheKey(), ads.data);
    return extractAdvertIds(ads.data);
  }
  return [];
}

async function syncStocks(): Promise<string> {
  const dateFrom = stocksDateFrom();
  const url = new URL(
    "https://statistics-api.wildberries.ru/api/v1/supplier/stocks",
  );
  url.searchParams.set("dateFrom", dateFrom);
  const stocks = await wbFetch<WbStock[]>(
    url.toString(),
    { method: "GET" },
    ["stocks", dateFrom],
    FORCE,
  );
  if (stocks.data) {
    await setCache(stocksCacheKey(), stocks.data);
    return "ok";
  }
  return stocks.error ?? "no data";
}

async function syncChunk(
  dateFrom: string,
  dateTo: string,
  advertIds: number[],
  label: string,
): Promise<Record<string, string>> {
  const results: Record<string, string> = {};

  const salesUrl = new URL(
    "https://statistics-api.wildberries.ru/api/v5/supplier/reportDetailByPeriod",
  );
  salesUrl.searchParams.set("dateFrom", dateFrom);
  salesUrl.searchParams.set("dateTo", dateTo);
  salesUrl.searchParams.set("limit", SALES_LIMIT);
  salesUrl.searchParams.set("rrdid", "0");

  const ordersUrl = new URL(
    "https://statistics-api.wildberries.ru/api/v1/supplier/orders",
  );
  ordersUrl.searchParams.set("dateFrom", dateFrom);
  ordersUrl.searchParams.set("flag", "0");

  const ids = advertIds.slice(0, 50);
  const statUrl = new URL(
    "https://advert-api.wildberries.ru/adv/v3/fullstats",
  );
  statUrl.searchParams.set("ids", ids.join(","));
  statUrl.searchParams.set("beginDate", dateFrom);
  statUrl.searchParams.set("endDate", dateTo);

  const fetches: Promise<void>[] = [
    wbFetch<WbReportRow[]>(
      salesUrl.toString(),
      { method: "GET" },
      ["sales", dateFrom, dateTo, SALES_LIMIT, "0"],
      FORCE,
    ).then(async (sales) => {
      if (sales.data) {
        await setCache(salesCacheKey(dateFrom, dateTo), sales.data);
        results[`${label}.sales`] = "ok";
      } else {
        results[`${label}.sales`] = sales.error ?? "no data";
      }
    }),
    wbFetch<WbOrder[]>(
      ordersUrl.toString(),
      { method: "GET" },
      ["orders", dateFrom, "0"],
      FORCE,
    ).then(async (orders) => {
      if (orders.data) {
        const filtered = filterOrdersInChunk(orders.data, dateFrom, dateTo);
        await setCache(ordersCacheKey(dateFrom, dateTo), filtered);
        results[`${label}.orders`] = "ok";
      } else {
        results[`${label}.orders`] = orders.error ?? "no data";
      }
    }),
  ];

  if (ids.length > 0) {
    fetches.push(
      wbFetch<WbAdStat[]>(
        statUrl.toString(),
        { method: "GET" },
        ["ads-stat-v3", dateFrom, dateTo, ...ids.map(String).sort()],
        FORCE,
      ).then(async (adStats) => {
        if (adStats.data) {
          await setCache(adStatsCacheKey(dateFrom, dateTo, ids), adStats.data);
          results[`${label}.adStats`] = "ok";
        } else {
          results[`${label}.adStats`] = adStats.error ?? "no data";
        }
      }),
    );
  } else {
    results[`${label}.adStats`] = "no ads";
  }

  await Promise.all(fetches);
  return results;
}

export async function runWbSync(
  options: WbSyncOptions = {},
): Promise<{
  ok: boolean;
  synced_at: string;
  results: Record<string, string>;
}> {
  const results: Record<string, string> = {};
  const synced_at = new Date().toISOString();
  const isFull = options.full ?? (!options.dateFrom && !options.dateTo);

  const chunks = isFull
    ? allSyncChunks()
    : options.dateFrom && options.dateTo
      ? chunksForRange(options.dateFrom, options.dateTo)
      : [chunkRange(0)];

  if (isFull) {
    const [advertIds] = await Promise.all([
      syncAds().then((ids) => {
        results.ads = ids.length > 0 ? "ok" : "no data";
        return ids;
      }),
      syncStocks().then((r) => {
        results.stocks = r;
      }),
    ]);

    const chunkResults = await Promise.all(
      chunks.map((c) =>
        syncChunk(c.dateFrom, c.dateTo, advertIds, `${c.dateFrom}`),
      ),
    );
    for (const cr of chunkResults) Object.assign(results, cr);
  } else {
    const advertIds = await resolveAdvertIds();
    if (advertIds.length === 0) results.ads = "no data";

    const chunkResults = await Promise.all(
      chunks.map((c) =>
        syncChunk(c.dateFrom, c.dateTo, advertIds, `${c.dateFrom}`),
      ),
    );
    for (const cr of chunkResults) Object.assign(results, cr);
  }

  await setCache(SYNC_META_KEY, { synced_at });

  return { ok: true, synced_at, results };
}
