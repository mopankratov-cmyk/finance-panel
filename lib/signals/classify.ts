// Классификатор «узкого места» SKU (порт сигналов infernoff). Чистая функция: метрики → сигнал.
// Источник метрик собирается в роуте: воронка wb_funnel_daily (открытия→корзина→заказ),
// РНП (остаток/оборачиваемость/ДРР), маржа — из решателя цены (lib/unit/priceSolver).
// Прим.: CTR «показ→клик» требует рекламных показов (wb_advert_nm_daily) — в v1 не используется;
// «Контент» опирается на конверсию открытие→корзина (карточку открыли, но не кладут).

export type SignalKind =
  | "Остатки" | "Маржа" | "ДРР" | "Контент" | "Конкуренты" | "Реклама" | "OK";
export type SignalSeverity = "info" | "warn" | "danger";

export interface SignalMetrics {
  /** воронка за окно: открытия карточки, добавления в корзину, заказы */
  opens: number;
  carts: number;
  orders: number;
  /** РНП */
  stock: number;
  turnoverDays: number | null;
  drr: number | null;
  /** маржа МД к выручке, % (из priceSolver.currentMarginPct) */
  marginPct: number | null;
  /** заказов за месяц — признак активности */
  ordersCountMonth: number;
}

export interface SignalThresholds {
  opensMin: number;     // «трафик есть», если открытий ≥
  cartConvMin: number;  // доля корзина/открытие
  orderConvMin: number; // доля заказ/корзина
  stockDaysMin: number; // дней остатка
  drrMax: number;       // %
  marginMin: number;    // %
}

// Стартовые пороги (как у Юры; калибровать на наших данных). Позже — по категориям.
export const DEFAULT_THRESHOLDS: SignalThresholds = {
  opensMin: 100,
  cartConvMin: 0.30,
  orderConvMin: 0.30,
  stockDaysMin: 14,
  drrMax: 25,
  marginMin: 15,
};

export interface SignalResult {
  signal: SignalKind;
  severity: SignalSeverity;
  reason: string;
}

const pc = (x: number) => Math.round(x * 100);

// Приоритет: операционно-критичное (остатки) → деньги (маржа, ДРР) → воронка (контент, конкуренты) → трафик.
export function classifySignal(m: SignalMetrics, t: SignalThresholds = DEFAULT_THRESHOLDS): SignalResult {
  const cartConv = m.opens > 0 ? m.carts / m.opens : null;
  const orderConv = m.carts > 0 ? m.orders / m.carts : null;

  if (m.turnoverDays != null && m.turnoverDays < t.stockDaysMin && m.stock > 0) {
    return { signal: "Остатки", severity: "warn", reason: `остаток на ${m.turnoverDays} дн (< ${t.stockDaysMin}) — дозаказ/поставка` };
  }
  if (m.marginPct != null && m.marginPct < t.marginMin) {
    return { signal: "Маржа", severity: m.marginPct < 0 ? "danger" : "warn", reason: `маржа ${m.marginPct}% < ${t.marginMin}% — пересмотр цены (решатель)` };
  }
  if (m.drr != null && m.drr > t.drrMax) {
    return { signal: "ДРР", severity: "warn", reason: `ДРР ${m.drr}% > ${t.drrMax}% — резать ставки/ключи` };
  }
  if (m.opens >= t.opensMin && cartConv != null && cartConv < t.cartConvMin) {
    return { signal: "Контент", severity: "warn", reason: `в корзину ${pc(cartConv)}% (< ${pc(t.cartConvMin)}%) при ${m.opens} открытиях — переделать фото/контент` };
  }
  if (m.opens >= t.opensMin && orderConv != null && orderConv < t.orderConvMin) {
    return { signal: "Конкуренты", severity: "info", reason: `заказ из корзины ${pc(orderConv)}% (< ${pc(t.orderConvMin)}%) — цена/конкуренты/сезон` };
  }
  if (m.opens < t.opensMin && m.ordersCountMonth < 5) {
    return { signal: "Реклама", severity: "info", reason: `мало трафика (${m.opens} открытий) — поднять ставку/добавить ключи` };
  }
  return { signal: "OK", severity: "info", reason: "узких мест не выявлено" };
}
