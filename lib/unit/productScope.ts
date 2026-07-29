import { cabinetBrandFilters } from "@/lib/wb/productScope";

interface CabinetScopeRow {
  name: unknown;
  trade_mark: unknown;
  brand_filters: unknown;
}

interface ProductScopeQueries {
  cabinet(): Promise<{
    data: CabinetScopeRow | null;
    error: { message?: string } | null;
  }>;
  scopeRows(): Promise<Array<{ nm_id: unknown }>>;
}

/** Fail-visible, cache/database-only product scope for one already-resolved group member. */
export async function loadUnitProductScope(
  cabinetId: string,
  queries: ProductScopeQueries,
): Promise<Set<number> | null> {
  const cabinet = await queries.cabinet();
  if (cabinet.error) throw new Error(cabinet.error.message || "Ошибка чтения товарного контура");
  if (!cabinet.data) throw new Error(`Кабинет ${cabinetId} недоступен`);
  const filters = cabinetBrandFilters(
    `${String(cabinet.data.name ?? "")} ${String(cabinet.data.trade_mark ?? "")}`,
    cabinet.data.brand_filters,
  );
  if (filters.length === 0) return null;

  const rows = await queries.scopeRows();
  const ids = rows
    .map((row) => Number(row.nm_id))
    .filter((nmId) => Number.isSafeInteger(nmId) && nmId > 0);
  return new Set(ids);
}
