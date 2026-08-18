import type { MonthWeek } from "./weeks";
import {
  aggregateWeek,
  sumWeeks,
  type OpiuOrder,
  type ProductCostRow,
  type WeekRawMetrics,
} from "./metrics";
import type { WbAdStat, WbReportRow } from "@/lib/wb/types";

export type OpiuRowKind = "metric" | "separator" | "percent";

export interface OpiuTableRow {
  id: string;
  label: string;
  kind: OpiuRowKind;
  values: (number | null)[];
  editable?: boolean;
  /** Расходная строка — положительное значение отображается как затрата */
  expense?: boolean;
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
  orders: OpiuOrder[],
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

  const zero = weeks.map(() => null as number | null).concat([null]);
  const sep = (id: string): OpiuTableRow => ({ id, label: "", kind: "separator", values: zero });

  const rows: OpiuTableRow[] = [
    { id: "orders",         label: "Заказы, руб",                                     kind: "metric",  values: cols((m) => m.ordersRub) },
    { id: "revenue_without_spp", label: "Выручка без СПП, руб",                       kind: "metric",  values: cols((m) => m.revenueWithoutSpp) },
    { id: "revenue",        label: "Выручка с учётом СПП, руб",                       kind: "metric",  values: cols((m) => m.revenue) },
    { id: "loyalty_comp",   label: "Компенсация скидки по программе лояльности, руб", kind: "metric",  values: cols((m) => m.loyaltyCompensation) },
    { id: "buyout",         label: "% выкупа",                                        kind: "percent", values: pctCols((d) => d.buyoutPct) },
    { id: "for_pay",        label: "К перечислению продавцу, руб",                    kind: "metric",  values: cols((m) => m.forPay) },
    sep("sep0"),
    { id: "commission",     label: "Комиссия ВБ, руб",                                kind: "metric",  expense: true, values: cols((m) => m.commission) },
    { id: "commission_pct", label: "% комиссии",                                      kind: "percent", values: rowValues(weekMetrics, (m) => pct(m.commission, m.revenue)) },
    { id: "logistics",      label: "Логистика, руб",                                  kind: "metric",  expense: true, values: cols((m) => m.logistics) },
    { id: "logistics_pct",  label: "% логистики",                                     kind: "percent", values: rowValues(weekMetrics, (m) => pct(m.logistics, m.revenue)) },
    { id: "cogs",           label: "Себестоимость, руб",                              kind: "metric",  expense: true, values: cols((m) => m.cogs) },
    { id: "cogs_pct",       label: "% себестоимости",                                 kind: "percent", values: rowValues(weekMetrics, (m) => pct(m.cogs, m.revenue)) },
    { id: "warehouse",      label: "Хранение / упаковка склада, руб",                 kind: "metric",  expense: true, editable: true, values: cols((m) => m.warehousePackaging) },
    { id: "storage_pct",    label: "% хранения",                                      kind: "percent", values: rowValues(weekMetrics, (m) => pct(m.warehousePackaging, m.revenue)) },
    { id: "other",          label: "Прочие удержания, руб",                           kind: "metric",  expense: true, values: cols((m) => m.otherDeductions) },
    { id: "transit",        label: "Транзитные поставки, руб",                        kind: "metric",  expense: true, values: zero },
    { id: "acceptance",     label: "Платная приёмка, руб",                            kind: "metric",  expense: true, values: zero },
    sep("sep1"),
    { id: "marginal",       label: "Маржинальный доход",                              kind: "metric",  values: rowValues(weekMetrics, (_m, d) => d.marginal) },
    { id: "marginal_pct",   label: "Рентабельность по МД, %",                         kind: "percent", values: pctCols((d) => d.marginalPct) },
    sep("sep2"),
    { id: "ads",            label: "ВБ продвижение, руб",                             kind: "metric",  expense: true, values: cols((m) => m.adsSpend) },
    { id: "drr",            label: "ДРР, %",                                          kind: "percent", values: rowValues(weekMetrics, (m) => pct(m.adsSpend, m.revenue)) },
    sep("sep3"),
    { id: "gross",          label: "Валовая прибыль",                                 kind: "metric",  values: rowValues(weekMetrics, (_m, d) => d.gross) },
    { id: "gross_pct",      label: "Рентабельность, %",                               kind: "percent", values: pctCols((d) => d.grossPct) },
    sep("sep4"),
    { id: "loan_transfer",  label: "Перевод на баланс заёмщика (займ/кредит)",        kind: "metric",  expense: true, values: zero },
    { id: "penalty_loan",   label: "Пени",                                            kind: "metric",  expense: true, values: zero },
  ];

  return { weeks, rows, warehouseByWeek };
}
