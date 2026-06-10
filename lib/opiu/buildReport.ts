import type { MonthWeek } from "./weeks";
import {
  aggregateWeek,
  sumWeeks,
  type ProductCostRow,
  type WeekRawMetrics,
} from "./metrics";
import type { WbAdStat, WbOrder, WbReportRow } from "@/lib/wb/types";

export type OpiuRowKind = "metric" | "separator" | "percent";

export interface OpiuTableRow {
  id: string;
  label: string;
  kind: OpiuRowKind;
  values: (number | null)[];
  editable?: boolean;
}

export interface OpiuReport {
  weeks: MonthWeek[];
  rows: OpiuTableRow[];
  warehouseByWeek: Record<string, number>;
}

function pct(numerator: number, denominator: number): number | null {
  if (!denominator) return null;
  return (numerator / denominator) * 100;
}

function derived(m: WeekRawMetrics) {
  const marginal =
    m.revenue - m.cogs - m.warehousePackaging - m.commission - m.logistics - m.otherDeductions;
  const gross = marginal - m.adsSpend;
  return {
    buyoutPct: pct(m.revenue, m.ordersRub),
    marginal,
    marginalPct: pct(marginal, m.revenue),
    gross,
    grossPct: pct(gross, m.revenue),
  };
}

function rowValues(
  weeks: WeekRawMetrics[],
  pick: (m: WeekRawMetrics, d: ReturnType<typeof derived>) => number | null,
): (number | null)[] {
  const weekVals = weeks.map((m) => pick(m, derived(m)));
  const total = sumWeeks(weeks);
  weekVals.push(pick(total, derived(total)));
  return weekVals;
}

export function buildOpiuReport(
  weeks: MonthWeek[],
  sales: WbReportRow[],
  orders: WbOrder[],
  adStats: WbAdStat[],
  costs: ProductCostRow[],
  warehouseByWeek: Record<string, number>,
): OpiuReport {
  const costLookup = {
    byArticle: new Map(costs.map((c) => [c.article.trim().toUpperCase(), c.cost_rub])),
    byBarcode: new Map(
      costs.filter((c) => c.wb_barcode).map((c) => [c.wb_barcode!, c.cost_rub]),
    ),
  };

  const weekMetrics = weeks.map((w) =>
    aggregateWeek(
      w,
      sales,
      orders,
      adStats,
      costLookup,
      warehouseByWeek[w.weekStart] ?? 0,
    ),
  );

  const cols = (fn: (m: WeekRawMetrics) => number) =>
    rowValues(weekMetrics, (m) => fn(m));

  const pctCols = (fn: (d: ReturnType<typeof derived>) => number | null) =>
    rowValues(weekMetrics, (_m, d) => fn(d));

  const rows: OpiuTableRow[] = [
    { id: "orders", label: "Заказы, руб", kind: "metric", values: cols((m) => m.ordersRub) },
    {
      id: "buyout",
      label: "% выкупа",
      kind: "percent",
      values: pctCols((d) => d.buyoutPct),
    },
    { id: "revenue", label: "Выручка, руб", kind: "metric", values: cols((m) => m.revenue) },
    { id: "cogs", label: "Себестоимость", kind: "metric", values: cols((m) => m.cogs) },
    {
      id: "warehouse",
      label: "Склад / упаковка",
      kind: "metric",
      values: cols((m) => m.warehousePackaging),
      editable: true,
    },
    { id: "commission", label: "Комиссия ВБ", kind: "metric", values: cols((m) => m.commission) },
    { id: "logistics", label: "Логистика ВБ", kind: "metric", values: cols((m) => m.logistics) },
    {
      id: "other",
      label: "Прочие удержания",
      kind: "metric",
      values: cols((m) => m.otherDeductions),
    },
    { id: "sep1", label: "", kind: "separator", values: weeks.map(() => null).concat([null]) },
    {
      id: "marginal",
      label: "Маржинальный доход",
      kind: "metric",
      values: rowValues(weekMetrics, (_m, d) => d.marginal),
    },
    {
      id: "marginal_pct",
      label: "Рентабельность МД, %",
      kind: "percent",
      values: pctCols((d) => d.marginalPct),
    },
    { id: "sep2", label: "", kind: "separator", values: weeks.map(() => null).concat([null]) },
    { id: "ads", label: "Реклама на МП", kind: "metric", values: cols((m) => m.adsSpend) },
    { id: "sep3", label: "", kind: "separator", values: weeks.map(() => null).concat([null]) },
    {
      id: "gross",
      label: "Валовая прибыль",
      kind: "metric",
      values: rowValues(weekMetrics, (_m, d) => d.gross),
    },
    {
      id: "gross_pct",
      label: "Рентабельность ВП, %",
      kind: "percent",
      values: pctCols((d) => d.grossPct),
    },
  ];

  return { weeks, rows, warehouseByWeek };
}
