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
 * Налог, комиссия кабинета и чистая прибыль. Считается НЕ на сервере: снимок РНП
 * кэшируется на 12 часов по ключу периода, и ставки в ключе размножили бы кэш.
 * Всё, что нужно, уже есть в ответе — выручка с выкупов, СПП и прибыль после
 * расходов МП, поэтому ставки применяются к готовым метрикам.
 *
 * База налога — цена покупателя: выкупы за вычетом СПП дня (та же семантика, что
 * в юнит-экономике после #406). День без известной СПП считается от цены
 * продавца — прежнее поведение, о котором говорит note, а не молчаливая догадка.
 *
 * Комиссия кабинета (посредник/агент) берётся с цены продавца и уменьшает
 * прибыль ДО налога в смысле порядка строк, но налоговую базу не меняет: налог
 * платится с оборота, а не с прибыли.
 *
 * `gross` намеренно остаётся прибылью ДО налога: это опубликованная семантика
 * метрики, менять её задним числом нельзя.
 */
export function appendTaxMetrics(
  metrics: Metric[],
  taxPct: number,
  options: { extraCommissionPct?: number } = {},
): Metric[] {
  const buyoutsSum = metrics.find((metric) => metric.field === "buyouts_sum");
  const gross = metrics.find((metric) => metric.field === "gross");
  if (!buyoutsSum || !gross) return metrics;
  if (metrics.some((metric) => metric.field === "tax_rub")) return metrics;
  const sppPct = metrics.find((metric) => metric.field === "spp_pct");
  const rate = Number.isFinite(taxPct) && taxPct > 0 ? taxPct : 0;
  const extraRate = Number.isFinite(options.extraCommissionPct) && Number(options.extraCommissionPct) > 0
    ? Number(options.extraCommissionPct)
    : 0;
  const note = `Ставка ${rate}% с цены покупателя (выкупы минус СПП дня); день без известной СПП считается от цены продавца. Ставка задаётся настройкой кабинета или панелью РНП, из WB не приходит.`;
  const coveragePct = Math.min(buyoutsSum.coveragePct ?? 0, gross.coveragePct ?? 0);
  const taxableDaily = buyoutsSum.daily.map((value, index) => {
    if (value == null) return null;
    const spp = sppPct?.daily[index];
    return spp == null ? Number(value) : Number(value) * (1 - Number(spp) / 100);
  });
  const taxDaily = taxableDaily.map((value) => value == null ? null : Math.round(value * rate / 100));
  const knownTax = taxDaily.filter((value): value is number => value != null);
  // Итог складывается из дневных: смешивать дни с известной и неизвестной СПП
  // общей ставкой от годового оборота нельзя.
  const taxTotal = knownTax.length ? knownTax.reduce((sum, value) => sum + value, 0) : null;
  const agentDaily = buyoutsSum.daily.map((value) => value == null ? null : Math.round(Number(value) * extraRate / 100));
  const knownAgent = agentDaily.filter((value): value is number => value != null);
  const agentTotal = extraRate > 0 && knownAgent.length ? knownAgent.reduce((sum, value) => sum + value, 0) : extraRate > 0 ? null : 0;
  const netDaily = gross.daily.map((value, index) => {
    if (value == null || taxDaily[index] == null) return null;
    const agent = extraRate > 0 ? agentDaily[index] : 0;
    if (agent == null) return null;
    return value - taxDaily[index]! - agent;
  });
  const netTotal = gross.total == null || taxTotal == null || agentTotal == null
    ? null
    : gross.total - taxTotal - agentTotal;
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
    ...(extraRate > 0 ? [{
      field: "agent_commission_rub",
      label: "Комиссия кабинета, ₽",
      kind: "money",
      daily: agentDaily,
      total: agentTotal,
      note: `Ставка ${extraRate}% с цены продавца — настройка кабинета (посредник/агент).`,
      ...shared,
    } as Metric] : []),
    { field: "tax_rub", label: "Налог, ₽", kind: "money", daily: taxDaily, total: taxTotal, note, ...shared },
    {
      field: "net_profit",
      label: "Чистая прибыль, ₽",
      kind: "money",
      daily: netDaily,
      total: netTotal,
      note: `Прибыль после расходов МП минус налог${extraRate > 0 ? " и комиссия кабинета" : ""}. ${note}`,
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
