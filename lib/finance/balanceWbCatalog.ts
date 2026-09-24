import { normalizeWbBrand, type WbProductScope } from "@/lib/wb/productScope";

export interface BalanceWbCatalogRow {
  cabinet_id: string | null;
  nm_id: number;
  article: string | null;
  brand?: string | null;
}

export interface BalanceWbCatalogItem {
  article: string;
  brand: string;
}

/**
 * Брендовый состав Баланса задан отдельно от аналитики: Retail Family —
 * NORVIA + Heaton, Оптима — NORVIA + Heaton + RIOBOX. allowedNmIds остаётся
 * fallback для строк старого каталога без бренда.
 */
export function balanceWbProductScope(cabinetName: string, scope: WbProductScope): WbProductScope {
  const name = normalizeWbBrand(cabinetName);
  if (name.includes("retailfamily")) return { brandFilters: ["norvia", "heaton"], allowedNmIds: scope.allowedNmIds };
  if (name.includes("optima") || name.includes("оптима")) return { brandFilters: ["norvia", "heaton", "riobox"], allowedNmIds: scope.allowedNmIds };
  return scope;
}

function inferBrand(article: string, brand: string): string {
  const normalized = normalizeWbBrand(brand);
  if (normalized) return normalized;
  const code = article.trim().toUpperCase();
  if (code.startsWith("HT-")) return "heaton";
  if (code.startsWith("NV-")) return "norvia";
  if (code.startsWith("ESC")) return "riobox";
  return "";
}

export function buildBalanceWbCatalogIndex(
  rows: readonly BalanceWbCatalogRow[],
): Map<string, Map<number, BalanceWbCatalogItem>> {
  const result = new Map<string, Map<number, BalanceWbCatalogItem>>();
  for (const row of rows) {
    const cabinetId = String(row.cabinet_id ?? "");
    const nmId = Number(row.nm_id);
    const article = String(row.article ?? "").trim();
    const brand = inferBrand(article, String(row.brand ?? ""));
    if (!cabinetId || !Number.isInteger(nmId) || nmId <= 0 || (!article && !brand)) continue;
    const cabinet = result.get(cabinetId) ?? new Map<number, BalanceWbCatalogItem>();
    const existing = cabinet.get(nmId);
    cabinet.set(nmId, { article: existing?.article || article, brand: existing?.brand || brand });
    result.set(cabinetId, cabinet);
  }
  return result;
}
