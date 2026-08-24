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

/**
 * % выкупа = Выручка без СПП / Заказы. Физически не может быть больше 100% —
 * если формула даёт больше, это всегда значит, что revenueWithoutSpp
 * (по дате продажи) и ordersRub (по дате заказа) сравнивают разные периоды
 * (например, заказы ещё не подтянулись за свежую неделю), а не реальный
 * бизнес-показатель. Показываем null, а не вводящее в заблуждение число.
 */
function buyoutPct(revenueWithoutSpp: number, ordersRub: number): number | null {
  const value = pct(revenueWithoutSpp, ordersRub);
  if (value === null || value > 100) return null;
  return value;
}

/**
 * Маржинальный доход = Выручка без СПП минус операционные расходы:
 * комиссия, логистика, себестоимость, штрафы, хранение, прочие удержания,
 * Джем, транзитные поставки, платная приёмка, "Вывести сейчас" (реальная
 * плата WB за досрочный вывод денег). "Подготовка" (упаковка) сюда тоже
 * входит по методологии, но пока это строка-заглушка без метрики —
 * добавится сама, как только появится поле в WeekRawMetrics.
 * "Перевод на баланс заёмщика" и "Пени" сознательно НЕ входят — это не
 * плата WB, а собственные финансовые обязательства продавца (займ/кредит).
 */
function derived(m: WeekRawMetrics) {
  const marginal =
    m.revenueWithoutSpp -
    m.commission -
    m.logistics -
    m.cogs -
    m.penalties -
    m.warehousePackaging -
    m.otherDeductions -
    m.subscriptionJem -
    m.transitDelivery -
    m.acceptance -
    m.withdrawNow;
  const gross = marginal - m.adsSpend;
  return {
    buyoutPct: buyoutPct(m.revenueWithoutSpp, m.ordersRub),
    marginal,
    marginalPct: pct(marginal, m.revenueWithoutSpp),
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
    // packaging: пока заглушка — требует поле packaging_rub в product_costs,
    // которого нет в базе (см. заявку docs/codemap про packaging_rub).
    { id: "packaging",      label: "Подготовка (упаковка, маркировка, отгрузка), руб", kind: "metric",  expense: true, values: zero },
    { id: "penalties",      label: "Штрафы и доплаты, руб",                           kind: "metric",  expense: true, values: cols((m) => m.penalties) },
    { id: "warehouse",      label: "Хранение, руб",                                   kind: "metric",  expense: true, values: cols((m) => m.warehousePackaging) },
    { id: "storage_pct",    label: "% хранения",                                      kind: "percent", values: rowValues(weekMetrics, (m) => pct(m.warehousePackaging, m.revenue)) },
    { id: "other",          label: "Прочие удержания, руб",                           kind: "metric",  expense: true, values: cols((m) => m.otherDeductions) },
    { id: "jem",            label: "Подписка «Джем», руб",                            kind: "metric",  expense: true, values: cols((m) => m.subscriptionJem) },
    { id: "withdraw_now",   label: "Вывести сейчас, руб",                             kind: "metric",  expense: true, values: cols((m) => m.withdrawNow) },
    { id: "transit",        label: "Транзитные поставки, руб",                        kind: "metric",  expense: true, values: cols((m) => m.transitDelivery) },
    { id: "acceptance",     label: "Платная приёмка, руб",                            kind: "metric",  expense: true, values: cols((m) => m.acceptance) },
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
    { id: "loan_transfer",  label: "Перевод на баланс заёмщика (займ/кредит)",        kind: "metric",  expense: true, values: cols((m) => m.loanTransfer) },
    { id: "penalty_loan",   label: "Пени",                                            kind: "metric",  expense: true, values: cols((m) => m.penaltyLoan) },
  ];

  return { weeks, rows, warehouseByWeek };
}
