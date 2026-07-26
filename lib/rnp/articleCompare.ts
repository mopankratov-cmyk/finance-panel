export interface RnpCompareMetric {
  field: string;
  label: string;
  kind: string;
  daily: (number | null)[];
  total: number | null;
}

export interface RnpCompareSku {
  nm: number;
  art: string;
  name: string;
  metrics: RnpCompareMetric[];
}

export interface RnpComparePeriod {
  label: string;
  period_type: string;
}

export interface RnpCompareLine {
  nm: number;
  key: string;
  label: string;
  total: number | null;
}

export interface RnpComparePoint {
  date: string;
  weekday: string;
  [key: string]: string | number | null;
}

export interface RnpArticleCompare {
  metricField: string;
  metricLabel: string;
  metricKind: string;
  lines: RnpCompareLine[];
  points: RnpComparePoint[];
}

function finite(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value);
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function metric(sku: RnpCompareSku, field: string) {
  return sku.metrics.find((item) => item.field === field) ?? null;
}

function knownSum(values: (number | null | undefined)[]) {
  const known = values.filter(finite);
  return known.length ? known.reduce((sum, value) => sum + value, 0) : null;
}

function ratio(numerator: number | null, denominator: number | null) {
  return finite(numerator) && finite(denominator) && denominator > 0 ? round1((numerator / denominator) * 100) : null;
}

function virtualMetric(sku: RnpCompareSku, field: string): RnpCompareMetric | null {
  if (field !== "cart_conversion") return metric(sku, field);
  const openCard = metric(sku, "open_card");
  const cart = metric(sku, "cart");
  if (!openCard || !cart) return null;
  const length = Math.max(openCard.daily.length, cart.daily.length);
  const daily = Array.from({ length }, (_, index) => {
    const openValue = openCard.daily[index];
    const cartValue = cart.daily[index];
    return ratio(cartValue, openValue);
  });
  return {
    field,
    label: "CR в корзину, %",
    kind: "pct",
    daily,
    total: ratio(knownSum(cart.daily), knownSum(openCard.daily)),
  };
}

function skuLabel(sku: RnpCompareSku) {
  return sku.art || sku.name || `WB ${sku.nm}`;
}

export function buildRnpArticleCompare(
  skus: RnpCompareSku[],
  period: RnpComparePeriod[],
  metricField: string,
  limit = 5,
): RnpArticleCompare {
  const candidates = skus
    .map((sku) => ({ sku, metric: virtualMetric(sku, metricField) }))
    .filter((item): item is { sku: RnpCompareSku; metric: RnpCompareMetric } => Boolean(item.metric))
    .sort((left, right) => {
      const leftValue = left.metric.total;
      const rightValue = right.metric.total;
      if (!finite(leftValue) && !finite(rightValue)) return skuLabel(left.sku).localeCompare(skuLabel(right.sku), "ru");
      if (!finite(leftValue)) return 1;
      if (!finite(rightValue)) return -1;
      return rightValue - leftValue;
    })
    .slice(0, Math.max(1, limit));

  const metricLabel = candidates[0]?.metric.label ?? metricField;
  const metricKind = candidates[0]?.metric.kind ?? "int";
  const lines = candidates.map(({ sku, metric: selectedMetric }) => ({
    nm: sku.nm,
    key: `sku_${sku.nm}`,
    label: skuLabel(sku),
    total: finite(selectedMetric.total) ? selectedMetric.total : null,
  }));
  const points = period.map((day, index) => {
    const point: RnpComparePoint = { date: day.label, weekday: day.period_type };
    for (const { sku, metric: selectedMetric } of candidates) {
      const value = selectedMetric.daily[index];
      point[`sku_${sku.nm}`] = finite(value) ? value : null;
    }
    return point;
  });

  return {
    metricField,
    metricLabel,
    metricKind,
    lines,
    points,
  };
}
