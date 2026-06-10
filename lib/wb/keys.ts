import { addDays, toISODate } from "@/lib/analytics/format";
import { cacheKey } from "./cache";

/** Размер одного чанка при синхронизации с WB */
export const CHUNK_DAYS = 7;

/** Сколько чанков храним (5 × 7 = 35 дней покрытия) */
export const SYNC_CHUNK_COUNT = 5;

export const SALES_LIMIT = "100000";

export function periodRange(days: number): { dateFrom: string; dateTo: string } {
  const to = new Date();
  const from = addDays(to, -(days - 1));
  return { dateFrom: toISODate(from), dateTo: toISODate(to) };
}

/** i=0 — последние 7 дней, i=1 — предыдущие 7 дней и т.д. */
export function chunkRange(index: number): { dateFrom: string; dateTo: string } {
  const today = new Date();
  const dateTo = addDays(today, -(index * CHUNK_DAYS));
  const dateFrom = addDays(dateTo, -(CHUNK_DAYS - 1));
  return { dateFrom: toISODate(dateFrom), dateTo: toISODate(dateTo) };
}

export function allSyncChunks(): Array<{ dateFrom: string; dateTo: string }> {
  return Array.from({ length: SYNC_CHUNK_COUNT }, (_, i) => chunkRange(i));
}

/** Чанки, пересекающиеся с запрошенным диапазоном */
export function chunksForRange(
  dateFrom: string,
  dateTo: string,
): Array<{ dateFrom: string; dateTo: string }> {
  return allSyncChunks().filter(
    (c) => c.dateFrom <= dateTo && c.dateTo >= dateFrom,
  );
}

export function stocksDateFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return toISODate(d);
}

export function salesCacheKey(dateFrom: string, dateTo: string): string {
  return cacheKey(["sales", dateFrom, dateTo, SALES_LIMIT, "0"]);
}

export function ordersCacheKey(dateFrom: string, dateTo: string): string {
  return cacheKey(["orders", dateFrom, dateTo, "0"]);
}

export function stocksCacheKey(): string {
  return cacheKey(["stocks", stocksDateFrom()]);
}

export function adsCacheKey(): string {
  return cacheKey(["ads-v2"]);
}

export function adStatsCacheKey(
  dateFrom: string,
  dateTo: string,
  advertIds: number[],
): string {
  return cacheKey([
    "ads-stat-v3",
    dateFrom,
    dateTo,
    ...advertIds.slice(0, 50).map(String).sort(),
  ]);
}

export const SYNC_META_KEY = cacheKey(["sync-meta"]);
