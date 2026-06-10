import { getCachedBatch } from "./cache";
import {
  legacyAdStatsKeys,
  legacyAdsKeys,
  legacyOrdersKeys,
  legacySalesKeys,
  legacyStocksKeys,
} from "./legacyKeys";
import {
  SYNC_META_KEY,
  adStatsCacheKey,
  adsCacheKey,
  chunksForRange,
  ordersCacheKey,
  salesCacheKey,
  stocksCacheKey,
} from "./keys";
import { mergeAdStats, mergeOrders, mergeSales } from "./merge";
import { extractAdvertIds } from "./types";
import type {
  WbAdStat,
  WbAdvertsResponse,
  WbOrder,
  WbReportRow,
  WbStock,
} from "./types";

export interface WbCacheData {
  sales: WbReportRow[];
  orders: WbOrder[];
  stocks: WbStock[];
  ads: WbAdvertsResponse | null;
  adStats: WbAdStat[];
  empty: boolean;
  timestamp: string;
}

function latestTimestamp(
  entries: Array<{ cached_at: string } | null | undefined>,
  syncMeta?: { synced_at: string } | null,
): string {
  if (syncMeta?.synced_at) return syncMeta.synced_at;
  const times = entries
    .filter(Boolean)
    .map((e) => new Date(e!.cached_at).getTime());
  if (times.length === 0) return "";
  return new Date(Math.max(...times)).toISOString();
}

async function loadRows<T>(
  candidates: string[],
): Promise<{ data: T[]; cached_at: string } | undefined> {
  const unique = [...new Set(candidates)];
  const batch = await getCachedBatch<T[]>(unique);
  for (const key of unique) {
    const hit = batch.get(key);
    if (hit && hit.data.length > 0) {
      return { data: hit.data, cached_at: hit.cached_at };
    }
  }
  return undefined;
}

export async function readWbCache(
  dateFrom: string,
  dateTo: string,
): Promise<WbCacheData> {
  const chunks = chunksForRange(dateFrom, dateTo);

  const salesCandidates = [
    salesCacheKey(dateFrom, dateTo),
    ...legacySalesKeys(dateFrom, dateTo),
    ...chunks.flatMap((c) => [
      salesCacheKey(c.dateFrom, c.dateTo),
      ...legacySalesKeys(c.dateFrom, c.dateTo),
    ]),
  ];

  const ordersCandidates = [
    ordersCacheKey(dateFrom, dateTo),
    ...legacyOrdersKeys(dateFrom, dateTo),
    ...chunks.flatMap((c) => [
      ordersCacheKey(c.dateFrom, c.dateTo),
      ...legacyOrdersKeys(c.dateFrom, c.dateTo),
    ]),
  ];

  const metaBatch = await getCachedBatch([
    stocksCacheKey(),
    ...legacyStocksKeys(),
    adsCacheKey(),
    ...legacyAdsKeys(),
    SYNC_META_KEY,
  ]);

  const [salesHit, ordersHit] = await Promise.all([
    loadRows<WbReportRow>(salesCandidates),
    loadRows<WbOrder>(ordersCandidates),
  ]);

  const stocksMeta =
    metaBatch.get(stocksCacheKey()) ??
    legacyStocksKeys()
      .map((k) => metaBatch.get(k))
      .find(Boolean);
  const adsMeta =
    metaBatch.get(adsCacheKey()) ??
    legacyAdsKeys()
      .map((k) => metaBatch.get(k))
      .find(Boolean);
  const syncMetaEntry = metaBatch.get(SYNC_META_KEY) as
    | { data: { synced_at: string }; cached_at: string }
    | undefined;

  const ads = (adsMeta?.data as WbAdvertsResponse | undefined) ?? null;
  const advertIds = extractAdvertIds(ads);

  const adStatsCandidates = [
    ...chunks.map((c) => adStatsCacheKey(c.dateFrom, c.dateTo, advertIds)),
    adStatsCacheKey(dateFrom, dateTo, advertIds),
    ...legacyAdStatsKeys(dateFrom, dateTo, advertIds),
  ];

  const adStatsHit =
    advertIds.length > 0
      ? await loadRows<WbAdStat>(adStatsCandidates)
      : undefined;

  const sales = salesHit?.data ?? [];
  const orders = ordersHit?.data ?? [];
  const adStats = adStatsHit?.data ?? [];

  const hasData = !!(
    sales.length ||
    orders.length ||
    stocksMeta ||
    adsMeta ||
    adStats.length
  );

  return {
    sales,
    orders,
    stocks: (stocksMeta?.data as WbStock[] | undefined) ?? [],
    ads,
    adStats,
    empty: !hasData,
    timestamp: latestTimestamp(
      [salesHit, ordersHit, adStatsHit, stocksMeta, adsMeta],
      syncMetaEntry?.data,
    ),
  };
}
