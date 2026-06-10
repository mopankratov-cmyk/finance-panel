import type { WbAdStat, WbOrder, WbReportRow } from "./types";

export function mergeSales(chunks: WbReportRow[][]): WbReportRow[] {
  return chunks.flat();
}

function orderKey(o: WbOrder): string {
  return [
    o.nmId,
    o.date,
    o.supplierArticle,
    o.lastChangeDate,
    o.warehouseName,
  ].join(":");
}

export function mergeOrders(chunks: WbOrder[][]): WbOrder[] {
  const seen = new Map<string, WbOrder>();
  for (const chunk of chunks) {
    for (const o of chunk) {
      seen.set(orderKey(o), o);
    }
  }
  return [...seen.values()];
}

export function mergeAdStats(chunks: WbAdStat[][]): WbAdStat[] {
  const byAdvert = new Map<number, WbAdStat>();

  for (const stats of chunks) {
    for (const stat of stats) {
      const id = stat.advertId ?? 0;
      const existing = byAdvert.get(id);

      if (!existing) {
        byAdvert.set(id, {
          ...stat,
          days: stat.days ? [...stat.days] : undefined,
        });
        continue;
      }

      existing.views = (existing.views ?? 0) + (stat.views ?? 0);
      existing.clicks = (existing.clicks ?? 0) + (stat.clicks ?? 0);
      existing.sum = (existing.sum ?? 0) + (stat.sum ?? 0);
      existing.orders = (existing.orders ?? 0) + (stat.orders ?? 0);
      existing.atbs = (existing.atbs ?? 0) + (stat.atbs ?? 0);
      existing.shks = (existing.shks ?? 0) + (stat.shks ?? 0);
      existing.sum_price = (existing.sum_price ?? 0) + (stat.sum_price ?? 0);

      const dayMap = new Map<string, NonNullable<WbAdStat["days"]>[number]>();
      for (const d of [...(existing.days ?? []), ...(stat.days ?? [])]) {
        const key = (d.date ?? "").slice(0, 10);
        if (!key) continue;
        const cur = dayMap.get(key) ?? { date: key };
        cur.views = (cur.views ?? 0) + (d.views ?? 0);
        cur.clicks = (cur.clicks ?? 0) + (d.clicks ?? 0);
        cur.sum = (cur.sum ?? 0) + (d.sum ?? 0);
        cur.orders = (cur.orders ?? 0) + (d.orders ?? 0);
        cur.sum_price = (cur.sum_price ?? 0) + (d.sum_price ?? 0);
        dayMap.set(key, cur);
      }
      existing.days = [...dayMap.values()].sort((a, b) =>
        (a.date ?? "").localeCompare(b.date ?? ""),
      );
    }
  }

  return [...byAdvert.values()];
}
