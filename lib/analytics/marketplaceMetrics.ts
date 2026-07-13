export type MarketplaceMetricId =
  | "views"
  | "ctr"
  | "cartToOrderCr"
  | "ordersRevenue"
  | "adSpend"
  | "drrOrders"
  | "drrAttributed"
  | "marginBeforeAds"
  | "marginAfterMarketplace";

export type MetricStatus = "unknown" | "neutral" | "good" | "warning" | "danger";

export interface MarketplaceMetricDefinition {
  label: string;
  unit: "count" | "money" | "percent";
  definition: string;
}

export const MARKETPLACE_METRICS: Record<MarketplaceMetricId, MarketplaceMetricDefinition> = {
  views: { label: "Показы", unit: "count", definition: "Показы карточки или рекламы за выбранный период." },
  ctr: { label: "CTR", unit: "percent", definition: "Клики / показы × 100%. Ниже 3% — внимание, от 10% — сильный результат." },
  cartToOrderCr: { label: "CR корзина→заказ", unit: "percent", definition: "Заказы, шт. / добавления в корзину × 100%. Ниже 3% — внимание, от 10% — сильный результат." },
  ordersRevenue: { label: "Заказы", unit: "money", definition: "Сумма оформленных заказов за выбранный период, до учёта выкупа." },
  adSpend: { label: "Реклама", unit: "money", definition: "Расход на продвижение за выбранный период." },
  drrOrders: { label: "ДРР к заказам", unit: "percent", definition: "Расход на рекламу / сумма всех заказов SKU × 100%. До 10% — норма, 10–20% — внимание, выше 20% — риск." },
  drrAttributed: { label: "ДРР рекламы", unit: "percent", definition: "Расход кампании / заказы, атрибутированные этой кампании × 100%. До 10% — норма, 10–20% — внимание, выше 20% — риск." },
  marginBeforeAds: { label: "Маржа до расходов МП", unit: "percent", definition: "(Цена заказа до СПП − себестоимость) / цена × 100%. Комиссия, логистика, эквайринг, налог и реклама ещё не вычтены; это не итоговая прибыльность." },
  marginAfterMarketplace: { label: "Маржа после расходов МП", unit: "percent", definition: "Прибыль после себестоимости, комиссии, эквайринга, налога и рекламы / выручка с выкупов × 100%. Ниже 0% — убыток, 0–10% — внимание." },
};

export function marketplaceMetricStatus(metric: MarketplaceMetricId, value: number | null | undefined): MetricStatus {
  if (value == null || !Number.isFinite(value)) return "unknown";
  if (metric === "drrOrders" || metric === "drrAttributed") {
    if (value < 0) return "unknown";
    if (value <= 10) return "good";
    if (value <= 20) return "warning";
    return "danger";
  }
  if (metric === "ctr" || metric === "cartToOrderCr") {
    if (value <= 0) return "unknown";
    if (value < 3) return "warning";
    if (value >= 10) return "good";
    return "neutral";
  }
  if (metric === "marginBeforeAds") {
    if (value < 0) return "danger";
    if (value < 30) return "warning";
    return "neutral";
  }
  if (metric === "marginAfterMarketplace") {
    if (value < 0) return "danger";
    if (value < 10) return "warning";
    return "good";
  }
  return "neutral";
}

export const METRIC_TEXT_TONE: Record<MetricStatus, string> = {
  unknown: "text-slate-400",
  neutral: "text-slate-600",
  good: "text-emerald-700",
  warning: "text-amber-600",
  danger: "font-semibold text-rose-600",
};

export const METRIC_BADGE_TONE: Record<MetricStatus, string> = {
  unknown: "bg-slate-100 text-slate-400",
  neutral: "bg-violet-50 text-violet-700",
  good: "bg-emerald-50 text-emerald-700",
  warning: "bg-amber-50 text-amber-700",
  danger: "bg-rose-50 text-rose-700",
};

export const METRIC_CELL_TONE: Record<MetricStatus, string> = {
  unknown: "bg-slate-50 text-slate-300",
  neutral: "bg-violet-50/70 text-violet-700",
  good: "bg-emerald-50 text-emerald-700",
  warning: "bg-amber-50 text-amber-700",
  danger: "bg-rose-50 text-rose-700",
};
