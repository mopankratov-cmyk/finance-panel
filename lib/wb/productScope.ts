export interface WbProductScope {
  brandFilters: string[];
  allowedNmIds: number[] | null;
}

export const OPTIMA_ALLOWED_BRANDS = ["norvia", "riobox"] as const;
export const RETAIL_FAMILY_ALLOWED_BRANDS = ["norvia"] as const;

export function normalizeWbBrand(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("ru-RU")
    .replace(/[^a-zа-яё0-9]+/gi, "");
}

export function normalizeBrandFilters(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(normalizeWbBrand).filter(Boolean))];
}

/**
 * «Оптима» is a permanently restricted cabinet. Even if the database setting
 * is temporarily absent during deploy, its token must never become an
 * unrestricted source.
 */
export function cabinetBrandFilters(cabinetName: unknown, configured: unknown): string[] {
  const normalizedName = normalizeWbBrand(cabinetName);
  if (normalizedName.includes("optima") || normalizedName.includes("оптима")) {
    return [...OPTIMA_ALLOWED_BRANDS];
  }
  if (normalizedName.includes("retailfamily")) {
    return [...RETAIL_FAMILY_ALLOWED_BRANDS];
  }
  return normalizeBrandFilters(configured);
}

export function isScoped(scope: WbProductScope): boolean {
  return scope.allowedNmIds !== null;
}

export function allowsNm(scope: WbProductScope, nmId: unknown): boolean {
  if (!isScoped(scope)) return true;
  const nm = Number(nmId);
  return Number.isFinite(nm) && scope.allowedNmIds!.includes(nm);
}

export function allowsBrand(scope: WbProductScope, brand: unknown): boolean {
  if (!isScoped(scope)) return true;
  const normalized = normalizeWbBrand(brand);
  return !!normalized && scope.brandFilters.includes(normalized);
}

export function allowsProduct(scope: WbProductScope, nmId: unknown, brand?: unknown): boolean {
  if (!isScoped(scope)) return true;
  // Если источник вернул бренд, он важнее исторического allowlist nmID:
  // устаревшая строка scope не должна открыть товар уже чужого бренда.
  // Для источников без поля brand сохраняем безопасный fallback на nmID.
  return normalizeWbBrand(brand) ? allowsBrand(scope, brand) : allowsNm(scope, nmId);
}
