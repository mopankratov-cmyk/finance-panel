import { getCachedBatch } from "./cache";
import { getLargeCacheWithMeta } from "./largeCache";
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

async function firstCachedRows<T>(
  keys: string[],
): Promise<{ data: T[]; cached_at: string } | undefined> {
  for (const key of keys) {
    const hit = await getLargeCacheWithMeta<T>(key);
    if (hit && hit.data.length > 0) return hit;
  }
  return undefined;
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

  const metaBatch = await getCachedBatch([
    stocksCacheKey(),
    ...legacyStocksKeys(),
    adsCacheKey(),
    ...legacyAdsKeys(),
    SYNC_META_KEY,
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

  const metaEntries: Array<{ cached_at: string } | undefined> = [
    stocksMeta,
    adsMeta,
  ];

  // Сначала точный ключ UI-диапазона, иначе — чанки
  const exactSales = await firstCachedRows<WbReportRow>([
    salesCacheKey(dateFrom, dateTo),
    ...legacySalesKeys(dateFrom, dateTo),
  ]);
  const salesChunks: WbReportRow[][] = [];
  if (exactSales) {
    salesChunks.push(exactSales.data);
    metaEntries.push(exactSales);
  } else {
    for (const c of chunks) {
      const hit = await firstCachedRows<WbReportRow>([
        salesCacheKey(c.dateFrom, c.dateTo),
        ...legacySalesKeys(c.dateFrom, c.dateTo),
      ]);
      if (hit) {
        salesChunks.push(hit.data);
        metaEntries.push(hit);
      }
    }
  }

  const exactOrders = await firstCachedRows<WbOrder>([
    ordersCacheKey(dateFrom, dateTo),
    ...legacyOrdersKeys(dateFrom, dateTo),
  ]);
  const ordersChunks: WbOrder[][] = [];
  if (exactOrders) {
    ordersChunks.push(exactOrders.data);
    metaEntries.push(exactOrders);
  } else {
    for (const c of chunks) {
      const hit = await firstCachedRows<WbOrder>([
        ordersCacheKey(c.dateFrom, c.dateTo),
        ...legacyOrdersKeys(c.dateFrom, c.dateTo),
      ]);
      if (hit) {
        ordersChunks.push(hit.data);
        metaEntries.push(hit);
      }
    }
  }

  const adStatsChunks: WbAdStat[][] = [];
  if (advertIds.length > 0) {
    const exactStats = await firstCachedRows<WbAdStat>([
      adStatsCacheKey(dateFrom, dateTo, advertIds),
      ...legacyAdStatsKeys(dateFrom, dateTo, advertIds),
    ]);
    if (exactStats) {
      adStatsChunks.push(exactStats.data);
      metaEntries.push(exactStats);
    } else {
      for (const c of chunks) {
        const hit = await firstCachedRows<WbAdStat>([
          adStatsCacheKey(c.dateFrom, c.dateTo, advertIds),
          ...legacyAdStatsKeys(c.dateFrom, c.dateTo, advertIds),
        ]);
        if (hit) {
          adStatsChunks.push(hit.data);
          metaEntries.push(hit);
        }
      }
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
    stocks: (stocksMeta?.data as WbStock[] | undefined) ?? [],
    ads,
    adStats,
    empty: !hasData,
    timestamp: latestTimestamp(metaEntries, syncMetaEntry?.data),
  };
}
