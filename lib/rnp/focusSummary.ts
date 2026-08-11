export interface RnpFocusMetric {
  field: string;
  total: number | null;
  status?: "ready" | "partial" | "unavailable";
  qualityReason?: "no_activity" | "missing_cost" | "missing_rates" | "stale_source" | "api_error" | "unsupported_source";
}

export interface RnpFocusSku {
  nm: number;
  art: string;
  name: string;
  metrics: RnpFocusMetric[];
}

export interface RnpFocusSignal {
  id: "stock_risk" | "high_drr" | "negative_margin" | "ads_without_orders" | "data_gaps";
  label: string;
  count: number;
  detail: string;
  tone: "rose" | "amber" | "slate";
}

export interface RnpFocusSummary {
  skuCount: number;
  ordersRub: number | null;
  ordersCount: number | null;
  buyoutsRub: number | null;
  buyoutsCount: number | null;
  buyoutPct: number | null;
  adSpent: number | null;
  drr: number | null;
  gross: number | null;
  marginPct: number | null;
  stock: number | null;
  stockMoney: number | null;
  gmroi: number | null;
  signals: RnpFocusSignal[];
}

interface FocusSkuSnapshot {
  sku: RnpFocusSku;
  ordersRub: number | null;
  ordersCount: number | null;
  buyoutsRub: number | null;
  buyoutsCount: number | null;
  adSpent: number | null;
  drr: number | null;
  gross: number | null;
  marginPct: number | null;
  stock: number | null;
  turnover: number | null;
}

const DATA_GAP_FIELDS = new Set(["views", "clicks", "open_card", "cart", "gross", "margin_pct", "money", "gmroi"]);

function finite(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value);
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function metric(sku: RnpFocusSku, field: string) {
  return sku.metrics.find((item) => item.field === field) ?? null;
}

function total(sku: RnpFocusSku, field: string) {
  const value = metric(sku, field)?.total;
  return finite(value) ? value : null;
}

function sum(values: Array<number | null>) {
  const known = values.filter(finite);
  return known.length ? known.reduce((acc, value) => acc + value, 0) : null;
}

function ratio(numerator: number | null, denominator: number | null, multiplier = 100) {
  return finite(numerator) && finite(denominator) && denominator > 0 ? round1((numerator / denominator) * multiplier) : null;
}

function skuLabel(sku: RnpFocusSku) {
  return sku.art || sku.name || `WB ${sku.nm}`;
}

function signalDetail(items: FocusSkuSnapshot[], empty: string, limit = 3) {
  if (!items.length) return empty;
  const names = items.slice(0, limit).map((item) => skuLabel(item.sku));
  const tail = items.length > limit ? ` + ещё ${items.length - limit}` : "";
  return `${names.join(", ")}${tail}`;
}

function buildSnapshot(sku: RnpFocusSku): FocusSkuSnapshot {
  const ordersRub = total(sku, "orders_sum");
  const ordersCount = total(sku, "orders_count");
  const buyoutsRub = total(sku, "buyouts_sum");
  const buyoutsCount = total(sku, "buyouts_count");
  const adSpent = total(sku, "ad_spent");
  return {
    sku,
    ordersRub,
    ordersCount,
    buyoutsRub,
    buyoutsCount,
    adSpent,
    drr: total(sku, "drr") ?? ratio(adSpent, ordersRub),
    gross: total(sku, "gross"),
    marginPct: total(sku, "margin_pct"),
    stock: total(sku, "stock"),
    turnover: total(sku, "turnover"),
  };
}

function hasDataGap(sku: RnpFocusSku) {
  return sku.metrics.some((item) =>
    DATA_GAP_FIELDS.has(item.field)
    && (item.status === "unavailable" || item.qualityReason === "missing_cost" || item.qualityReason === "missing_rates" || item.qualityReason === "api_error")
  );
}

export function buildRnpFocusSummary(skus: RnpFocusSku[]): RnpFocusSummary {
  const snapshots = skus.map(buildSnapshot);
  const ordersRub = sum(snapshots.map((item) => item.ordersRub));
  const ordersCount = sum(snapshots.map((item) => item.ordersCount));
  const buyoutsRub = sum(snapshots.map((item) => item.buyoutsRub));
  const buyoutsCount = sum(snapshots.map((item) => item.buyoutsCount));
  const adSpent = sum(snapshots.map((item) => item.adSpent));
  const gross = sum(snapshots.map((item) => item.gross));
  const stock = sum(snapshots.map((item) => item.stock));
  const stockMoney = sum(skus.map((sku) => total(sku, "money")));

  const stockRisk = snapshots
    .filter((item) => (item.ordersCount ?? 0) > 0 && ((item.stock != null && item.stock <= 0) || (item.turnover != null && item.turnover <= 10)))
    .sort((a, b) => (a.turnover ?? 9999) - (b.turnover ?? 9999) || (a.stock ?? 9999) - (b.stock ?? 9999) || (b.ordersRub ?? 0) - (a.ordersRub ?? 0));
  const highDrr = snapshots
    .filter((item) => (item.ordersRub ?? 0) > 0 && (item.drr ?? 0) >= 30)
    .sort((a, b) => (b.drr ?? 0) - (a.drr ?? 0));
  const negativeMargin = snapshots
    .filter((item) => (item.marginPct != null && item.marginPct < 0) || (item.gross != null && item.gross < 0))
    .sort((a, b) => (a.marginPct ?? 9999) - (b.marginPct ?? 9999) || (a.gross ?? 0) - (b.gross ?? 0));
  const adsWithoutOrders = snapshots
    .filter((item) => (item.adSpent ?? 0) > 0 && (item.ordersRub ?? 0) <= 0)
    .sort((a, b) => (b.adSpent ?? 0) - (a.adSpent ?? 0));
  const dataGaps = snapshots
    .filter((item) => hasDataGap(item.sku))
    .sort((a, b) => (b.ordersRub ?? 0) - (a.ordersRub ?? 0));

  return {
    skuCount: skus.length,
    ordersRub,
    ordersCount,
    buyoutsRub,
    buyoutsCount,
    buyoutPct: ratio(buyoutsCount, ordersCount),
    adSpent,
    drr: ratio(adSpent, ordersRub),
    gross,
    marginPct: ratio(gross, buyoutsRub),
    stock,
    stockMoney,
    gmroi: ratio(gross, stockMoney),
    signals: [
      {
        id: "stock_risk",
        label: "Риск дефицита ≤10 дней",
        count: stockRisk.length,
        detail: signalDetail(stockRisk, "По текущему срезу острых дефицитов нет"),
        tone: stockRisk.length ? "rose" : "slate",
      },
      {
        id: "high_drr",
        label: "ДРР к заказам ≥30%",
        count: highDrr.length,
        detail: signalDetail(highDrr, "ДРР в норме по видимым SKU"),
        tone: highDrr.length ? "amber" : "slate",
      },
      {
        id: "negative_margin",
        label: "Маржа ниже нуля",
        count: negativeMargin.length,
        detail: signalDetail(negativeMargin, "Отрицательной маржи не видно"),
        tone: negativeMargin.length ? "rose" : "slate",
      },
      {
        id: "ads_without_orders",
        label: "Реклама без заказов",
        count: adsWithoutOrders.length,
        detail: signalDetail(adsWithoutOrders, "Нет расходов без заказов"),
        tone: adsWithoutOrders.length ? "amber" : "slate",
      },
      {
        id: "data_gaps",
        label: "Пробелы данных",
        count: dataGaps.length,
        detail: signalDetail(dataGaps, "Критичных пробелов по экономике/воронке нет"),
        tone: dataGaps.length ? "amber" : "slate",
      },
    ],
  };
}
