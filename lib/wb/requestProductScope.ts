import { cabinetProductScope, getWbCabinet } from "@/lib/wb/cabinetTokens";
import { isScoped } from "@/lib/wb/productScope";

/** null means unrestricted; an empty Set means restricted and fail-closed. */
export async function requestAllowedNmIds(cabinetId: string | null): Promise<Set<number> | null> {
  if (!cabinetId) return null;
  const cabinet = await getWbCabinet(cabinetId);
  if (!cabinet) return new Set<number>();
  const scope = cabinetProductScope(cabinet);
  return isScoped(scope) ? new Set(scope.allowedNmIds ?? []) : null;
}

export function requestAllowsNm(allowedNmIds: Set<number> | null, nmId: unknown): boolean {
  if (allowedNmIds === null) return true;
  const nm = Number(nmId);
  return Number.isFinite(nm) && allowedNmIds.has(nm);
}
