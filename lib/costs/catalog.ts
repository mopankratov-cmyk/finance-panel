export interface StoredCostRow {
  article: string;
  name?: string | null;
  cost_rub?: number | string | null;
  /**
   * Фулфилмент на единицу: приёмка, упаковка, маркировка, отгрузка.
   * Историческое имя колонки — warehouse_expenses, и в коде маржи оно зовётся
   * то storage, то prep. По данным это именно ФФ: 9–187 ₽ на единицу у 170 из
   * 215 товаров. Экран называет его тем, что это есть на самом деле.
   */
  warehouse_expenses?: number | string | null;
  brand?: string | null;
  category?: string | null;
}

export interface MarketplaceCostProduct {
  article: string;
  name?: string | null;
  brand?: string | null;
  source: "WB" | "Ozon";
  resolvedCostRub?: number | null;
  resolvedFrom?: string | null;
}

export interface CostCatalogRow {
  article: string;
  name: string;
  cost_rub: number;
  /** Фулфилмент на единицу — вторая половина того, что уходит в маржу. */
  fulfillment_rub: number;
  brand: string;
  category: string;
  source: string;
  inherited_from: string | null;
}

function articleKey(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim().toLocaleUpperCase("ru-RU");
}

function clean(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

/**
 * Объединяет ручной справочник себестоимости с фактическими каталогами
 * маркетплейсов. Раньше экран видел только сохранённые строки и поэтому мог
 * показывать ложные 100%, когда у нового SKU себестоимость ещё не была заведена.
 */
export function mergeCostCatalog(
  storedRows: readonly StoredCostRow[],
  marketplaceProducts: readonly MarketplaceCostProduct[],
) {
  const rows = new Map<string, CostCatalogRow & { sources: Set<string> }>();

  for (const item of storedRows) {
    const article = clean(item.article);
    const key = articleKey(article);
    if (!key) continue;
    rows.set(key, {
      article,
      name: clean(item.name) || article,
      cost_rub: Number(item.cost_rub ?? 0) || 0,
      fulfillment_rub: Number(item.warehouse_expenses ?? 0) || 0,
      brand: clean(item.brand),
      category: clean(item.category),
      source: "Справочник",
      inherited_from: null,
      sources: new Set(),
    });
  }

  for (const product of marketplaceProducts) {
    const article = clean(product.article);
    const key = articleKey(article);
    if (!key) continue;
    const existing = rows.get(key);
    if (existing) {
      existing.sources.add(product.source);
      if ((!existing.name || existing.name === existing.article) && clean(product.name)) {
        existing.name = clean(product.name);
      }
      if (!existing.brand && clean(product.brand)) existing.brand = clean(product.brand);
      continue;
    }
    rows.set(key, {
      article,
      name: clean(product.name) || article,
      cost_rub: Number(product.resolvedCostRub ?? 0) || 0,
      // Маркетплейс о фулфилменте не знает: он наш, а не его.
      fulfillment_rub: 0,
      brand: clean(product.brand),
      category: "",
      source: product.source,
      inherited_from: clean(product.resolvedFrom) || null,
      sources: new Set([product.source]),
    });
  }

  const merged = [...rows.values()]
    .map(({ sources, ...row }) => ({
      ...row,
      source: sources.size ? [...sources].sort().join(", ") : "Справочник",
    }))
    .sort((left, right) => {
      const leftMissing = left.cost_rub <= 0 ? 0 : 1;
      const rightMissing = right.cost_rub <= 0 ? 0 : 1;
      return leftMissing - rightMissing || left.article.localeCompare(right.article, "ru");
    });
  const filled = merged.filter((row) => row.cost_rub > 0).length;
  return {
    rows: merged,
    count: merged.length,
    filled,
    missing: merged.length - filled,
  };
}
