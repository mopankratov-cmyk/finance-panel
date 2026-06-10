import { getCached, setCache } from "./cache";
import { setLargeCache } from "./largeCache";
import { trimAdStats, trimAdverts, trimOrders, trimSales } from "./trim";
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
    await setCache(adsCacheKey(), trimAdverts(ads.data));
    return extractAdvertIds(ads.data);
  }
  return [];
}

async function syncAds(): Promise<number[]> {
  const ads = await wbFetch<WbAdvertsResponse>(
    "https://advert-api.wildberries.ru/api/advert/v2/adverts",
    { method: "GET" },
    undefined,
    FORCE,
  );
  if (ads.data) {
    await setCache(adsCacheKey(), trimAdverts(ads.data));
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

  const sales = await wbFetch<WbReportRow[]>(
    salesUrl.toString(),
    { method: "GET" },
    undefined,
    FORCE,
  );
  if (sales.data) {
    const ok = await setLargeCache(
      salesCacheKey(dateFrom, dateTo),
      trimSales(sales.data),
    );
    results[`${label}.sales`] = ok ? "ok" : "cache write failed";
  } else {
    results[`${label}.sales`] = sales.error ?? "no data";
  }

  const orders = await wbFetch<WbOrder[]>(
    ordersUrl.toString(),
    { method: "GET" },
    undefined,
    FORCE,
  );
  if (orders.data) {
    const filtered = filterOrdersInChunk(orders.data, dateFrom, dateTo);
    const ok = await setLargeCache(
      ordersCacheKey(dateFrom, dateTo),
      trimOrders(filtered),
    );
    results[`${label}.orders`] = ok ? "ok" : "cache write failed";
  } else {
    results[`${label}.orders`] = orders.error ?? "no data";
  }

  if (ids.length > 0) {
    const adStats = await wbFetch<WbAdStat[]>(
      statUrl.toString(),
      { method: "GET" },
      undefined,
      FORCE,
    );
    if (adStats.data) {
      const ok = await setLargeCache(
        adStatsCacheKey(dateFrom, dateTo, ids),
        trimAdStats(adStats.data),
      );
      results[`${label}.adStats`] = ok ? "ok" : "cache write failed";
    } else {
      results[`${label}.adStats`] = adStats.error ?? "no data";
    }
  } else {
    results[`${label}.adStats`] = "no ads";
  }

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

  let advertIds: number[] = [];

  if (isFull) {
    const adsIds = await syncAds();
    advertIds = adsIds;
    results.ads = adsIds.length > 0 ? "ok" : "no data";
    results.stocks = await syncStocks();
  } else {
    advertIds = await resolveAdvertIds();
    if (advertIds.length === 0) results.ads = "no data";
  }

  for (const c of chunks) {
    const cr = await syncChunk(c.dateFrom, c.dateTo, advertIds, `${c.dateFrom}`);
    Object.assign(results, cr);
  }

  await setCache(SYNC_META_KEY, { synced_at });

  return { ok: true, synced_at, results };
}
