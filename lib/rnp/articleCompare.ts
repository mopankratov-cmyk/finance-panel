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

function metric(sku: RnpCompareSku, field: string) {
  return sku.metrics.find((item) => item.field === field) ?? null;
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
    .map((sku) => ({ sku, metric: metric(sku, metricField) }))
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
