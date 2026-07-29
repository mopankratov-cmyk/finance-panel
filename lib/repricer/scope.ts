import { allowsNm, type WbProductScope } from "../wb/productScope";

export interface RepricerScopedRow {
  cabinet?: string | null;
  nm_id: number;
}

/**
 * Historical decisions can predate cabinet product scoping. Re-apply the
 * current cabinet scope when decisions are read or exported so Optima never
 * leaks products outside NORVIA/RIOBOX through old rows.
 */
export function filterRepricerRowsByScopes<T extends RepricerScopedRow>(
  rows: T[],
  scopes: ReadonlyMap<string, WbProductScope>,
): T[] {
  return rows.filter((row) => {
    const cabinetId = String(row.cabinet ?? "");
    const scope = scopes.get(cabinetId);
    return scope ? allowsNm(scope, row.nm_id) : true;
  });
}
