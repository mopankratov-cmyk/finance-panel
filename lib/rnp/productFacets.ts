export interface RnpFacetMetric {
  field: string;
  total: number | null;
}

export interface RnpFacetSku {
  nm: number;
  art: string;
  name: string;
  brand?: string;
  subject?: string;
  metrics: RnpFacetMetric[];
}

function cleanFacet(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function sortedUnique(values: string[]) {
  return [...new Set(values.filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, "ru", { sensitivity: "base" }));
}

export function rnpBrandOptions(skus: RnpFacetSku[]) {
  return sortedUnique(skus.map((sku) => cleanFacet(sku.brand)));
}

export function rnpCategoryOptions(
  skus: RnpFacetSku[],
  fallbackByArticle: Record<string, string> = {},
) {
  // Рука вперёд предмета. Пока категорий не было ни одной, порядок роли не
  // играл; теперь играет: вписанная владельцем категория должна пересилить
  // предмет WB, а не наоборот, иначе РНП единственный её проигнорирует.
  return sortedUnique(skus.map((sku) =>
    cleanFacet(fallbackByArticle[sku.art]) || cleanFacet(sku.subject)));
}

export function filterRnpProductFacets<T extends RnpFacetSku>(
  skus: T[],
  input: {
    brand?: string;
    category?: string;
    fallbackCategoryByArticle?: Record<string, string>;
  },
): T[] {
  const brand = cleanFacet(input.brand);
  const category = cleanFacet(input.category);
  const fallbackByArticle = input.fallbackCategoryByArticle ?? {};

  return skus.filter((sku) => {
    const skuBrand = cleanFacet(sku.brand);
    const skuCategory = cleanFacet(fallbackByArticle[sku.art]) || cleanFacet(sku.subject);
    if (brand && skuBrand !== brand) return false;
    if (category === "__none") return !skuCategory;
    return !category || skuCategory === category;
  });
}

export function sortRnpProducts<T extends RnpFacetSku>(
  skus: T[],
  field: string,
  direction: 1 | -1,
) {
  return skus
    .map((sku, index) => ({ sku, index }))
    .sort((left, right) => {
      const leftValue = left.sku.metrics.find((metric) => metric.field === field)?.total;
      const rightValue = right.sku.metrics.find((metric) => metric.field === field)?.total;
      if (leftValue == null && rightValue == null) return left.index - right.index;
      if (leftValue == null) return 1;
      if (rightValue == null) return -1;
      const delta = direction * (leftValue - rightValue);
      return delta || left.index - right.index;
    })
    .map(({ sku }) => sku);
}
