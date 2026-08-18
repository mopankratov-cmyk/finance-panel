// Компактная передача таблицы РНП. У крупного кабинета (351 SKU × 64 метрики)
// ответ весил 8.5 МБ, из которых 3.8 МБ — ОДИНАКОВЫЕ подписи метрик (label,
// kind, source, note), продублированные в каждом артикуле; самих чисел — 0.6 МБ.
// Поэтому по сети едет словарь метрик один раз, а в артикулах остаются только
// поле и значения. Снимок в кэше не меняется — сжимаем на отдаче, разжимаем
// сразу после загрузки, и весь остальной код работает с прежней формой.

interface MetricLike {
  field: string;
  label: string;
  kind: string;
  source?: string;
  note?: string;
}

interface TableLike {
  summary: MetricLike[];
  skus: { metrics: MetricLike[] }[];
}

export interface RnpMetricDictionaryEntry {
  label: string;
  kind: string;
  source?: string;
  note?: string;
}

/** Поля, одинаковые для всех артикулов, — они и уезжают в словарь. */
const SHARED_FIELDS = ["label", "kind", "source", "note"] as const;

export function compactRnpTable<T extends TableLike>(table: T): T & { metric_dictionary: Record<string, RnpMetricDictionaryEntry> } {
  type SkuOf = T["skus"][number];
  type MetricOf = SkuOf["metrics"][number];
  const dictionary: Record<string, RnpMetricDictionaryEntry> = {};
  // Словарь берём из сводки: она содержит полный каталог с подписями.
  for (const metric of table.summary) {
    if (dictionary[metric.field]) continue;
    dictionary[metric.field] = {
      label: metric.label,
      kind: metric.kind,
      ...(metric.source ? { source: metric.source } : {}),
      ...(metric.note ? { note: metric.note } : {}),
    };
  }
  const skus = table.skus.map((sku) => ({
    ...sku,
    metrics: sku.metrics.map((metric) => {
      const shared = dictionary[metric.field];
      if (!shared) return metric;
      const compact = { ...metric } as Record<string, unknown>;
      for (const field of SHARED_FIELDS) {
        // Своё значение оставляем: у артикула бывает свой note (причина пробела).
        if (compact[field] === shared[field]) delete compact[field];
      }
      return compact as unknown as MetricOf;
    }),
  }));
  return { ...table, skus, metric_dictionary: dictionary };
}

export function expandRnpTable<T extends TableLike & { metric_dictionary?: Record<string, RnpMetricDictionaryEntry> }>(table: T): T {
  type MetricOf = T["skus"][number]["metrics"][number];
  const dictionary = table.metric_dictionary;
  if (!dictionary) return table; // старый формат ответа — уже полный
  return {
    ...table,
    skus: table.skus.map((sku) => ({
      ...sku,
      metrics: sku.metrics.map((metric) => {
        const shared = dictionary[metric.field];
        if (!shared) return metric;
        // Ключей из словаря в компактной метрике нет вовсе, поэтому подписи
        // доезжают, а собственные значения метрики (свой note) приоритетны.
        return { ...shared, ...metric } as MetricOf;
      }),
    })),
  };
}
