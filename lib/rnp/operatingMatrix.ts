export const RNP_METRIC_FIELDS = [
  "views",
  "clicks",
  "ctr",
  "open_card",
  "cart",
  "orders_sum",
  "orders_count",
  "buyouts_sum",
  "buyouts_count",
  "buyout_pct",
  "gross",
  "margin_pct",
  "ad_spent",
  "drr",
  "stock",
  "turnover",
  "money",
  "gmroi",
] as const;

export type RnpMetricField = (typeof RNP_METRIC_FIELDS)[number];
export type RnpViewId = "main" | "conversion" | "ads" | "stock" | "economy" | "custom";
export type RnpDeltaMode = "percent" | "absolute";
export type RnpAnomalyDirection = "all" | "negative" | "positive";

export interface RnpOperatingMetric {
  field: string;
  kind: string;
  total: number | null;
  daily?: Array<number | null>;
}

export interface RnpOperatingSku {
  nm: number;
  art: string;
  name: string;
  metrics: RnpOperatingMetric[];
}

export interface RnpMetricDelta {
  absolute: number;
  percent: number | null;
  direction: "up" | "down" | "flat";
}

export interface RnpAnomaly {
  field: string;
  label: string;
  direction: "positive" | "negative";
  delta: RnpMetricDelta;
}

export const RNP_VIEW_PRESETS: ReadonlyArray<{
  id: Exclude<RnpViewId, "custom">;
  label: string;
  description: string;
  fields: RnpMetricField[];
}> = [
  {
    id: "main",
    label: "Основное",
    description: "Заказы, выкупы, прибыль и реклама",
    fields: ["orders_sum", "orders_count", "buyouts_sum", "buyouts_count", "buyout_pct", "gross", "margin_pct", "ad_spent", "drr"],
  },
  {
    id: "conversion",
    label: "Конверсии",
    description: "Показы, переходы, корзины и выкуп",
    fields: ["views", "clicks", "ctr", "open_card", "cart", "orders_count", "buyout_pct"],
  },
  {
    id: "ads",
    label: "Реклама",
    description: "Трафик, расходы и эффективность",
    fields: ["views", "clicks", "ctr", "open_card", "orders_sum", "orders_count", "ad_spent", "drr"],
  },
  {
    id: "stock",
    label: "Остатки",
    description: "Остаток, оборачиваемость и деньги на складе",
    fields: ["orders_count", "buyouts_count", "stock", "turnover", "money"],
  },
  {
    id: "economy",
    label: "Юнит-экономика",
    description: "Выручка, прибыль, маржа и GMROI",
    fields: ["orders_sum", "buyouts_sum", "gross", "margin_pct", "ad_spent", "drr", "money", "gmroi"],
  },
];

const POSITIVE_WHEN_UP = new Set([
  "views",
  "clicks",
  "ctr",
  "open_card",
  "cart",
  "orders_sum",
  "orders_count",
  "buyouts_sum",
  "buyouts_count",
  "buyout_pct",
  "gross",
  "margin_pct",
  "stock",
  "gmroi",
]);
const POSITIVE_WHEN_DOWN = new Set(["drr", "turnover"]);

const METRIC_LABELS: Record<string, string> = {
  views: "Показы",
  clicks: "Клики",
  ctr: "CTR",
  open_card: "Переходы",
  cart: "Корзины",
  orders_sum: "Заказы, ₽",
  orders_count: "Заказы, шт",
  buyouts_sum: "Выкупы, ₽",
  buyouts_count: "Выкупы, шт",
  buyout_pct: "Выкуп",
  gross: "Прибыль",
  margin_pct: "Маржа",
  ad_spent: "Реклама",
  drr: "ДРР",
  stock: "Остаток",
  turnover: "Оборачиваемость",
  money: "Деньги в остатках",
  gmroi: "GMROI",
};

function finite(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value);
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function previousEqualRange(from: string, to: string) {
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1);
  const previousEnd = new Date(start);
  previousEnd.setUTCDate(previousEnd.getUTCDate() - 1);
  const previousStart = new Date(previousEnd);
  previousStart.setUTCDate(previousStart.getUTCDate() - days + 1);
  return { from: isoDate(previousStart), to: isoDate(previousEnd) };
}

export function sanitizeMetricFields(value: unknown, fallback: readonly string[] = RNP_VIEW_PRESETS[0].fields): RnpMetricField[] {
  if (!Array.isArray(value)) return [...fallback] as RnpMetricField[];
  const allowed = new Set<string>(RNP_METRIC_FIELDS);
  const seen = new Set<string>();
  const result = value
    .filter((field): field is string => {
      if (typeof field !== "string" || !allowed.has(field) || seen.has(field)) return false;
      seen.add(field);
      return true;
    })
    .map((field) => {
      return field as RnpMetricField;
    });
  return result.length ? result : [...fallback] as RnpMetricField[];
}

export function parseArticleList(value: string) {
  return [...new Set(
    value
      .normalize("NFKC")
      .split(/[\s,;]+/)
      .map((item) => item.trim().toLocaleLowerCase("ru-RU"))
      .filter(Boolean),
  )].slice(0, 500);
}

export function matchesArticleList(sku: Pick<RnpOperatingSku, "nm" | "art" | "name">, query: string) {
  const tokens = parseArticleList(query);
  if (!tokens.length) return true;
  const art = sku.art.normalize("NFKC").toLocaleLowerCase("ru-RU");
  const name = sku.name.normalize("NFKC").toLocaleLowerCase("ru-RU");
  const nm = String(sku.nm);
  return tokens.some((token) => art.includes(token) || name.includes(token) || nm.includes(token));
}

export function metricDelta(current: number | null | undefined, previous: number | null | undefined): RnpMetricDelta | null {
  if (!finite(current) || !finite(previous)) return null;
  const absolute = Math.round((current - previous) * 10) / 10;
  const percent = previous === 0 ? null : Math.round((absolute / Math.abs(previous)) * 1_000) / 10;
  return {
    absolute,
    percent,
    direction: absolute > 0 ? "up" : absolute < 0 ? "down" : "flat",
  };
}

export function dayOverDayBaseline(
  currentDaily: Array<number | null | undefined>,
  previousPeriodDaily: Array<number | null | undefined> | undefined,
  index: number,
) {
  if (!Number.isSafeInteger(index) || index < 0 || index >= currentDaily.length) return null;
  if (index > 0) return currentDaily[index - 1] ?? null;
  return previousPeriodDaily?.at(-1) ?? null;
}

export function isOpenMoscowDayLabel(label: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
  }).formatToParts(now);
  const day = parts.find((part) => part.type === "day")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return Boolean(day && month && label === `${day}.${month}`);
}

export function anomalyDirection(field: string, delta: RnpMetricDelta): "positive" | "negative" | null {
  if (delta.direction === "flat" || field === "ad_spent" || field === "money") return null;
  if (POSITIVE_WHEN_DOWN.has(field)) return delta.direction === "down" ? "positive" : "negative";
  if (POSITIVE_WHEN_UP.has(field)) return delta.direction === "up" ? "positive" : "negative";
  return null;
}

export function detectSkuAnomalies(
  current: RnpOperatingSku,
  previous: RnpOperatingSku | null | undefined,
  thresholdPct = 30,
  ratioThresholdPoints = 5,
): RnpAnomaly[] {
  if (!previous) return [];
  const previousByField = new Map(previous.metrics.map((metric) => [metric.field, metric]));
  const anomalies: RnpAnomaly[] = [];
  for (const metric of current.metrics) {
    const previousMetric = previousByField.get(metric.field);
    const delta = metricDelta(metric.total, previousMetric?.total);
    if (!delta) continue;
    const changeMagnitude = metric.kind === "pct" ? Math.abs(delta.absolute) : Math.abs(delta.percent ?? 0);
    const threshold = metric.kind === "pct" ? ratioThresholdPoints : thresholdPct;
    if (changeMagnitude < threshold) continue;
    const direction = anomalyDirection(metric.field, delta);
    if (!direction) continue;
    anomalies.push({
      field: metric.field,
      label: METRIC_LABELS[metric.field] ?? metric.field,
      direction,
      delta,
    });
  }
  return anomalies.sort((left, right) => {
    const leftMagnitude = Math.abs(left.delta.percent ?? left.delta.absolute);
    const rightMagnitude = Math.abs(right.delta.percent ?? right.delta.absolute);
    return rightMagnitude - leftMagnitude;
  });
}

export function filterAnomalies(anomalies: RnpAnomaly[], direction: RnpAnomalyDirection) {
  return direction === "all" ? anomalies : anomalies.filter((anomaly) => anomaly.direction === direction);
}
