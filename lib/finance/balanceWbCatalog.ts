import { normalizeWbBrand, type WbProductScope } from "@/lib/wb/productScope";

export interface BalanceWbCatalogRow {
  cabinet_id: string | null;
  nm_id: number;
  article: string | null;
}

/**
 * Retail Family — собственный кабинет: брендовый фильтр нужен аналитике, но
 * в Балансе должен учитываться весь принадлежащий нам товар этого кабинета.
 * Для агентской Оптимы и других ограниченных контуров сохраняем их allowlist.
 */
export function balanceWbProductScope(cabinetName: string, scope: WbProductScope): WbProductScope {
  return normalizeWbBrand(cabinetName).includes("retailfamily")
    ? { brandFilters: [], allowedNmIds: null }
    : scope;
}

export function buildBalanceWbArticleIndex(
  rows: readonly BalanceWbCatalogRow[],
): Map<string, Map<number, string>> {
  const result = new Map<string, Map<number, string>>();
  for (const row of rows) {
    const cabinetId = String(row.cabinet_id ?? "");
    const nmId = Number(row.nm_id);
    const article = String(row.article ?? "").trim();
    if (!cabinetId || !Number.isInteger(nmId) || nmId <= 0 || !article) continue;
    const cabinet = result.get(cabinetId) ?? new Map<number, string>();
    if (!cabinet.has(nmId)) cabinet.set(nmId, article);
    result.set(cabinetId, cabinet);
  }
  return result;
}
