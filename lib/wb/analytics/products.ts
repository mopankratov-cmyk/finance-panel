import type { WbOrder, WbReportRow, WbStock } from "@/lib/wb/types";
import type { DateRange } from "./sales";

export interface StockAlertSummary {
  outOfStock: number;
  low: number;
  normal: number;
  excess: number;
}

export interface StockRow {
  nmId: number;
  article: string;
  name: string;
  warehouse: string;
  stock: number;
  salesPerDay: number;
  daysToZero: number;
  frozenRub: number;
  status: "critical" | "reorder" | "normal" | "excess";
  reorderQty: number;
}

function isSale(row: WbReportRow): boolean {
  const t = (row.doc_type_name ?? "").toLowerCase();
  return t.includes("продаж") || t.includes("sale");
}

export function computeStockAlerts(rows: StockRow[]): StockAlertSummary {
  return {
    outOfStock: rows.filter((r) => r.stock === 0).length,
    low: rows.filter((r) => r.status === "reorder").length,
    normal: rows.filter((r) => r.status === "normal").length,
    excess: rows.filter((r) => r.status === "excess").length,
  };
}

export function computeStocks(
  stocks: WbStock[],
  salesRows: WbReportRow[],
  range: DateRange,
  costs: Record<number, number>,
): StockRow[] {
  const days = Math.max(
    1,
    Math.round(
      (new Date(range.to).getTime() - new Date(range.from).getTime()) / 86400000,
    ) + 1,
  );
  const periodDays = Math.min(days, 14);

  const salesByNm = new Map<number, number>();
  for (const r of salesRows) {
    if (!isSale(r)) continue;
    const d = (r.sale_dt ?? r.order_dt ?? "").slice(0, 10);
    if (d < range.from || d > range.to) continue;
    const nm = r.nm_id ?? 0;
    salesByNm.set(nm, (salesByNm.get(nm) ?? 0) + Math.abs(r.quantity ?? 0));
  }

  const aggregated = new Map<string, StockRow>();

  for (const s of stocks) {
    const nmId = s.nmId ?? 0;
    const warehouse = s.warehouseName ?? "Неизвестно";
    const key = `${nmId}-${warehouse}`;
    const qty = s.quantity ?? s.quantityFull ?? 0;
    const totalSales = salesByNm.get(nmId) ?? 0;
    const salesPerDay = totalSales / periodDays;
    const daysToZero = salesPerDay > 0 ? qty / salesPerDay : qty > 0 ? 999 : 0;
    const cost = costs[nmId] ?? 0;
    const frozenRub = qty * cost;

    let status: StockRow["status"] = "normal";
    if (qty === 0) status = "critical";
    else if (daysToZero < 14) status = "reorder";
    else if (daysToZero > 90) status = "excess";

    const reorderQty = Math.max(0, Math.ceil(salesPerDay * 30 * 1.5) - qty);

    const existing = aggregated.get(key);
    if (existing) {
      existing.stock += qty;
      existing.frozenRub += frozenRub;
      existing.daysToZero = salesPerDay > 0 ? existing.stock / salesPerDay : existing.daysToZero;
    } else {
      aggregated.set(key, {
        nmId,
        article: s.supplierArticle ?? String(nmId),
        name: s.subject ?? s.category ?? s.supplierArticle ?? String(nmId),
        warehouse,
        stock: qty,
        salesPerDay,
        daysToZero,
        frozenRub,
        status,
        reorderQty,
      });
    }
  }

  return Array.from(aggregated.values()).sort((a, b) => a.daysToZero - b.daysToZero);
}

export interface WarehouseRow {
  warehouse: string;
  stock: number;
  pct: number;
}

export function computeWarehouseDistribution(stocks: WbStock[]): WarehouseRow[] {
  const map = new Map<string, number>();
  let total = 0;
  for (const s of stocks) {
    const w = s.warehouseName ?? "Неизвестно";
    const q = s.quantity ?? s.quantityFull ?? 0;
    map.set(w, (map.get(w) ?? 0) + q);
    total += q;
  }
  return Array.from(map.entries())
    .map(([warehouse, stock]) => ({
      warehouse,
      stock,
      pct: total > 0 ? (stock / total) * 100 : 0,
    }))
    .sort((a, b) => b.stock - a.stock);
}

export function aggregateSalesPerDay(orders: WbOrder[], days = 14): Map<number, number> {
  const map = new Map<number, number>();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  for (const o of orders) {
    if (o.isCancel) continue;
    const d = new Date(o.date ?? "");
    if (d < cutoff) continue;
    const nm = o.nmId ?? 0;
    if (nm) map.set(nm, (map.get(nm) ?? 0) + 1);
  }
  return map;
}
