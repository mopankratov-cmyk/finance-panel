// Налоговый слой РНП живёт отдельным модулем намеренно: он применяется на
// КЛИЕНТЕ, а lib/rnp/buildTable тянет Supabase-админа и другие серверные модули —
// импорт оттуда утащил бы их в браузерный бандл. Здесь только тип (стирается при
// компиляции) и чистый хелпер покрытия.
import { statusForCoverage } from "@/lib/rnp/forecast";
import type { Metric } from "@/lib/rnp/buildTable";

/**
 * Ставка налога по умолчанию — та же, что в юнит-экономике (`lib/unit/query.ts`),
 * чтобы одна и та же карточка не считалась по разным ставкам в разных разделах.
 */
export const RNP_DEFAULT_TAX_PCT = 7;

/**
 * Налог и чистая прибыль. Считается НЕ на сервере: снимок РНП кэшируется на 12
 * часов по ключу периода, и ставка налога в ключе размножила бы кэш на каждое
 * значение. Всё, что нужно, уже есть в ответе — выручка с выкупов и прибыль
 * после расходов МП, поэтому ставка применяется к готовым метрикам.
 *
 * `gross` намеренно остаётся прибылью ДО налога: это опубликованная семантика
 * метрики, менять её задним числом нельзя.
 */
export function appendTaxMetrics(metrics: Metric[], taxPct: number): Metric[] {
  const buyoutsSum = metrics.find((metric) => metric.field === "buyouts_sum");
  const gross = metrics.find((metric) => metric.field === "gross");
  if (!buyoutsSum || !gross) return metrics;
  if (metrics.some((metric) => metric.field === "tax_rub")) return metrics;
  const rate = Number.isFinite(taxPct) && taxPct > 0 ? taxPct : 0;
  const note = `Ставка ${rate}% с выручки по выкупам — задаётся в панели РНП, а не приходит из WB.`;
  const coveragePct = Math.min(buyoutsSum.coveragePct ?? 0, gross.coveragePct ?? 0);
  const taxDaily = buyoutsSum.daily.map((value) => value == null ? null : Math.round(value * rate / 100));
  const taxTotal = buyoutsSum.total == null ? null : Math.round(buyoutsSum.total * rate / 100);
  const netDaily = gross.daily.map((value, index) => value == null || taxDaily[index] == null ? null : value - taxDaily[index]);
  const netTotal = gross.total == null || taxTotal == null ? null : gross.total - taxTotal;
  const netMarginDaily = netDaily.map((value, index) => {
    const revenue = buyoutsSum.daily[index];
    return value == null || revenue == null || revenue <= 0 ? null : Math.round((value / revenue) * 1000) / 10;
  });
  const shared = {
    forecast: null,
    coveragePct,
    status: statusForCoverage(coveragePct),
    source: "WB Финотчёт + себестоимость + WB Реклама",
    qualityReason: gross.qualityReason,
  };
  const anchor = metrics.findIndex((metric) => metric.field === "margin_pct");
  const taxMetrics: Metric[] = [
    { field: "tax_rub", label: "Налог, ₽", kind: "money", daily: taxDaily, total: taxTotal, note, ...shared },
    {
      field: "net_profit",
      label: "Чистая прибыль, ₽",
      kind: "money",
      daily: netDaily,
      total: netTotal,
      note: `Прибыль после расходов МП минус налог. ${note}`,
      ...shared,
    },
    {
      field: "net_margin_pct",
      label: "Чистая маржа, %",
      kind: "pct",
      daily: netMarginDaily,
      total: netTotal != null && buyoutsSum.total != null && buyoutsSum.total > 0
        ? Math.round((netTotal / buyoutsSum.total) * 1000) / 10
        : null,
      note: `Чистая прибыль / выручка по выкупам. ${note}`,
      ...shared,
    },
  ];
  if (anchor >= 0) metrics.splice(anchor + 1, 0, ...taxMetrics);
  else metrics.push(...taxMetrics);
  return metrics;
}
