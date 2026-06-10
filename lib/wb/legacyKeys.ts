import { cacheKey } from "./cache";
import { stocksDateFrom } from "./keys";

/** Ключи из предыдущих версий — для чтения до пересинхронизации */
export function legacySalesKeys(dateFrom: string, dateTo: string): string[] {
  return [
    cacheKey(["sales", dateFrom, dateTo, "100000", "0"]),
    cacheKey(["sales", dateFrom, dateTo, "10000", "0"]),
  ];
}

export function legacyOrdersKeys(dateFrom: string, dateTo?: string): string[] {
  const keys = [cacheKey(["orders", dateFrom, "0"])];
  if (dateTo) keys.push(cacheKey(["orders", dateFrom, dateTo, "0"]));
  return keys;
}

export function legacyStocksKeys(): string[] {
  const df = stocksDateFrom();
  return [cacheKey(["stocks", df]), cacheKey(["stocks"])];
}

export function legacyAdsKeys(): string[] {
  return [cacheKey(["ads-v2"]), cacheKey(["ads"]), cacheKey(["ads-count"])];
}

export function legacyAdStatsKeys(
  dateFrom: string,
  dateTo: string,
  advertIds: number[],
): string[] {
  const sorted = advertIds.slice(0, 50).map(String).sort();
  return [
    cacheKey(["ads-stat-v3", dateFrom, dateTo, ...sorted]),
    cacheKey(["ads-stat", ...sorted]),
    cacheKey(["adStats", advertIds.slice(0, 50).join(",")]),
  ];
}
