export interface WbProductScope {
  brandFilters: string[];
  allowedNmIds: number[] | null;
}

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
  return allowsNm(scope, nmId) || allowsBrand(scope, brand);
}
