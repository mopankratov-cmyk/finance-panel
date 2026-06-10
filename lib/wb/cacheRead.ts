import { getCachedBatch } from "./cache";
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

export async function readWbCache(
  dateFrom: string,
  dateTo: string,
): Promise<WbCacheData> {
  const chunks = chunksForRange(dateFrom, dateTo);
  const stocksKey = stocksCacheKey();
  const adsKey = adsCacheKey();

  const baseKeys = [stocksKey, adsKey, SYNC_META_KEY];
  const chunkKeys: string[] = [];
  for (const c of chunks) {
    chunkKeys.push(salesCacheKey(c.dateFrom, c.dateTo));
    chunkKeys.push(ordersCacheKey(c.dateFrom, c.dateTo));
  }

  const batch = await getCachedBatch([...baseKeys, ...chunkKeys]);

  const stocksMeta = batch.get(stocksKey) as
    | { data: WbStock[]; cached_at: string }
    | undefined;
  const adsMeta = batch.get(adsKey) as
    | { data: WbAdvertsResponse; cached_at: string }
    | undefined;
  const syncMetaEntry = batch.get(SYNC_META_KEY) as
    | { data: { synced_at: string }; cached_at: string }
    | undefined;

  const ads = adsMeta?.data ?? null;
  const advertIds = extractAdvertIds(ads);

  const salesChunks: WbReportRow[][] = [];
  const ordersChunks: WbOrder[][] = [];
  const metaEntries: Array<{ cached_at: string } | undefined> = [
    stocksMeta,
    adsMeta,
  ];

  for (const c of chunks) {
    const sk = salesCacheKey(c.dateFrom, c.dateTo);
    const ok = ordersCacheKey(c.dateFrom, c.dateTo);
    const salesMeta = batch.get(sk) as
      | { data: WbReportRow[]; cached_at: string }
      | undefined;
    const ordersMeta = batch.get(ok) as
      | { data: WbOrder[]; cached_at: string }
      | undefined;
    salesChunks.push(salesMeta?.data ?? []);
    ordersChunks.push(ordersMeta?.data ?? []);
    metaEntries.push(salesMeta, ordersMeta);
  }

  const adStatsKeys =
    advertIds.length > 0
      ? chunks.map((c) => adStatsCacheKey(c.dateFrom, c.dateTo, advertIds))
      : [];

  const adStatsChunks: WbAdStat[][] = [];
  if (adStatsKeys.length > 0) {
    const statsBatch = await getCachedBatch<WbAdStat[]>(adStatsKeys);
    for (const key of adStatsKeys) {
      const meta = statsBatch.get(key);
      adStatsChunks.push(meta?.data ?? []);
      metaEntries.push(meta);
    }
  }

  const sales = mergeSales(salesChunks);
  const orders = mergeOrders(ordersChunks);
  const adStats = mergeAdStats(adStatsChunks);

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
    stocks: stocksMeta?.data ?? [],
    ads,
    adStats,
    empty: !hasData,
    timestamp: latestTimestamp(metaEntries, syncMetaEntry?.data),
  };
}
