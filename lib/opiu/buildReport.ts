import type { MonthWeek } from "./weeks";
import {
  aggregateWeek,
  sumWeeks,
  type ProductCostRow,
  type WeekRawMetrics,
} from "./metrics";
import type { WbOrder, WbReportRow } from "@/lib/wb/types";
import type { AdvertSpendRow } from "./metrics";
import type { DeliveryCostRow } from "./fetchGoogleCosts";
import type { NmStatRow } from "./fetchNmStats";

export type OpiuRowKind = "metric" | "separator" | "percent";

export interface OpiuTableRow {
  id: string;
  label: string;
  kind: OpiuRowKind;
  values: (number | null)[];
  editable?: boolean;
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
    m.revenueWithoutSpp -
    m.commission -
    m.logistics -
    m.cogs -
    m.packaging -
    m.penalties -
    m.storage -
    m.otherDeductions -
    m.withdrawNow +
    m.loyaltyCompensation -
    m.subscriptionJem -
    m.transitDelivery -
    m.acceptance;
  const gross = marginal - m.adsSpend;
  return {
    buyoutPct: pct(m.revenueWithoutSpp, m.ordersRub),
    commissionPct: pct(m.commission, m.revenueWithoutSpp),
    logisticsPct: pct(m.logistics, m.revenueWithoutSpp),
    cogsPct: pct(m.cogs, m.revenueWithoutSpp),
    storagePct: pct(m.storage, m.revenueWithoutSpp),
    drr: pct(m.adsSpend, m.revenueWithoutSpp),
    marginal,
    marginalPct: pct(marginal, m.revenueWithoutSpp),
    gross,
    grossPct: pct(gross, m.revenueWithoutSpp),
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
  adStats: AdvertSpendRow[],
  costs: ProductCostRow[],
  deliveryCosts: DeliveryCostRow[],
  nmStats: NmStatRow[] = [],
): OpiuReport {
  const costLookup = {
    costByArticle: new Map(costs.map((c) => [c.article.trim().toUpperCase(), c.cost_rub])),
    costByBarcode: new Map(
      costs.filter((c) => c.wb_barcode).map((c) => [c.wb_barcode!, c.cost_rub]),
    ),
    packByArticle: new Map(costs.map((c) => [c.article.trim().toUpperCase(), c.packaging_rub])),
    packByBarcode: new Map(
      costs.filter((c) => c.wb_barcode).map((c) => [c.wb_barcode!, c.packaging_rub]),
    ),
    costByGiBarcode: new Map(deliveryCosts.map((d) => [`${d.gi_id}|${d.barcode}`, d.cost_rub])),
    packByGiBarcode: new Map(deliveryCosts.map((d) => [`${d.gi_id}|${d.barcode}`, d.packaging_rub])),
  };

  const weekMetrics = weeks.map((w) =>
    aggregateWeek(w, sales, orders, adStats, costLookup, nmStats),
  );

  const cols = (fn: (m: WeekRawMetrics) => number) =>
    rowValues(weekMetrics, (m) => fn(m));

  const pctCols = (fn: (d: ReturnType<typeof derived>) => number | null) =>
    rowValues(weekMetrics, (_m, d) => fn(d));

  let sepIdx = 0;
  const sep = (): OpiuTableRow => ({
    id: `sep${sepIdx++}`,
    label: "",
    kind: "separator",
    values: weeks.map(() => null).concat([null]),
  });

  const rows: OpiuTableRow[] = [
    { id: "orders",           label: "Заказы, руб",                                  kind: "metric",  values: cols((m) => m.ordersRub) },
    { id: "rev_no_spp",       label: "Выручка без СПП, руб",                         kind: "metric",  values: cols((m) => m.revenueWithoutSpp) },
    { id: "loyalty_comp",    label: "Компенсация скидки по программе лояльности, руб", kind: "metric", expense: false, values: cols((m) => m.loyaltyCompensation) },
    { id: "revenue",          label: "Выручка с учётом СПП, руб",                    kind: "metric",  values: cols((m) => m.revenue) },
    { id: "buyout",           label: "% выкупа",                                     kind: "percent", values: pctCols((d) => d.buyoutPct) },
    { id: "for_pay",          label: "К перечислению продавцу, руб",                 kind: "metric",  values: cols((m) => m.forPay) },
    sep(),
    { id: "commission",       label: "Комиссия ВБ, руб",                             kind: "metric",  expense: true, values: cols((m) => m.commission) },
    { id: "commission_pct",   label: "% комиссии",                                   kind: "percent", values: pctCols((d) => d.commissionPct) },
    { id: "logistics",        label: "Логистика, руб",                               kind: "metric",  expense: true, values: cols((m) => m.logistics) },
    { id: "logistics_pct",    label: "% логистики",                                  kind: "percent", values: pctCols((d) => d.logisticsPct) },
    { id: "cogs",             label: "Себестоимость, руб",                           kind: "metric",  expense: true, values: cols((m) => m.cogs) },
    { id: "cogs_pct",         label: "% себестоимости",                              kind: "percent", values: pctCols((d) => d.cogsPct) },
    { id: "packaging",        label: "Подготовка (упаковка, маркировка, отгрузка)",  kind: "metric",  expense: true, values: cols((m) => m.packaging) },
    { id: "penalties",        label: "Штрафы и доплаты, руб",                        kind: "metric",  expense: true, values: cols((m) => m.penalties) },
    { id: "storage",          label: "Хранение, руб",                                kind: "metric",  expense: true, values: cols((m) => m.storage) },
    { id: "storage_pct",      label: "% хранения",                                   kind: "percent", values: pctCols((d) => d.storagePct) },
    { id: "other",            label: "Прочие удержания, руб",                        kind: "metric",  expense: true, values: cols((m) => m.otherDeductions) },
    { id: "withdraw_now",     label: "Вывести сейчас, руб",                          kind: "metric",  expense: true, values: cols((m) => m.withdrawNow) },
    { id: "jem",              label: "Подписка «Джем», руб",                         kind: "metric",  expense: true, values: cols((m) => m.subscriptionJem) },
    { id: "transit",          label: "Транзитные поставки, руб",                     kind: "metric",  expense: true, values: cols((m) => m.transitDelivery) },
    { id: "acceptance",       label: "Платная приёмка, руб",                         kind: "metric",  expense: true, values: cols((m) => m.acceptance) },
    sep(),
    { id: "marginal",         label: "Маржинальный доход",                           kind: "metric",  values: rowValues(weekMetrics, (_m, d) => d.marginal) },
    { id: "marginal_pct",     label: "Рентабельность по МД, %",                      kind: "percent", values: pctCols((d) => d.marginalPct) },
    sep(),
    { id: "ads",              label: "ВБ продвижение, руб",                          kind: "metric",  expense: true, values: cols((m) => m.adsSpend) },
    { id: "drr",              label: "ДРР, %",                                       kind: "percent", values: pctCols((d) => d.drr) },
    sep(),
    { id: "gross",            label: "Валовая прибыль",                              kind: "metric",  values: rowValues(weekMetrics, (_m, d) => d.gross) },
    { id: "gross_pct",        label: "Рентабельность, %",                            kind: "percent", values: pctCols((d) => d.grossPct) },
    sep(),
    { id: "loan_transfer",    label: "Перевод на баланс заёмщика (займ/кредит)",    kind: "metric",  expense: true, values: cols((m) => m.loanTransfer) },
    { id: "penalty_loan",     label: "Пени",                                         kind: "metric",  expense: true, values: cols((m) => m.penaltyLoan) },
  ];

  return { weeks, rows, warehouseByWeek: {} };
}
