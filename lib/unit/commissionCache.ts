import { resolveWbRatesForNm, type NmRates, type WbCommission } from "@/lib/wb/commissions";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";

export interface UnitCommissionQueryResult {
  data: unknown[] | null;
  error: { message: string } | null;
}

export type UnitCommissionQuery = (
  table: "wb_nm_commissions" | "wb_cabinet_commission_overhead",
  columns: string,
  cabinetId: string,
  from: number,
  to: number,
) => Promise<UnitCommissionQueryResult>;

export interface UnitNmRates {
  factual: boolean;
  marketplacePct: number | null;
  acquiringPct: number | null;
}

const positive = (value: number) => Number.isFinite(value) && value > 0;
const nonNegative = (value: number) => Number.isFinite(value) && value >= 0;
const canonicalNumericString = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const strictNumber = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !canonicalNumericString.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const unavailable = (): UnitNmRates => ({
  factual: false,
  marketplacePct: null,
  acquiringPct: null,
});

export async function loadUnitCommissionCache(query: UnitCommissionQuery, cabinetId: string) {
  const [nmResult, overheadResult] = await Promise.all([
    loadAllSupabasePages(
      (from, to) => query("wb_nm_commissions", "nm_id, pct, acq_pct, extra_pct, rev", cabinetId, from, to),
      { label: "Unit group: ставки WB", maxPages: 100 },
    ),
    query("wb_cabinet_commission_overhead", "overhead_pct", cabinetId, 0, 0),
  ]);
  if (overheadResult.error) throw new Error(overheadResult.error.message || "Ошибка чтения общих удержаний WB");

  const overhead = strictNumber(
    (overheadResult.data?.[0] as { overhead_pct?: unknown } | undefined)?.overhead_pct,
  );
  if (nmResult.length === 0 || overhead === null || !nonNegative(overhead)) {
    return {
      resolve(): UnitNmRates {
        return unavailable();
      },
    };
  }

  const byNm = new Map<number, NmRates>();
  let pctWeighted = 0;
  let pctRevenue = 0;
  let acqWeighted = 0;
  let acqRevenue = 0;
  let extraWeighted = 0;
  let extraRevenue = 0;
  for (const raw of nmResult) {
    const row = raw as { nm_id?: unknown; pct?: unknown; acq_pct?: unknown; extra_pct?: unknown; rev?: unknown };
    const nmId = Number(row.nm_id);
    const pct = strictNumber(row.pct);
    const acqPct = strictNumber(row.acq_pct);
    const extraPct = strictNumber(row.extra_pct);
    const rev = strictNumber(row.rev);
    if (!Number.isFinite(nmId) || rev === null || !positive(rev)) continue;
    if (extraPct === null || !nonNegative(extraPct)) continue;
    byNm.set(nmId, {
      pct: pct ?? Number.NaN,
      acqPct: acqPct ?? Number.NaN,
      extraPct,
      rev,
    });
    if (pct !== null && acqPct !== null && positive(pct) && positive(acqPct)) {
      pctWeighted += pct * rev;
      pctRevenue += rev;
      acqWeighted += acqPct * rev;
      acqRevenue += rev;
      extraWeighted += extraPct * rev;
      extraRevenue += rev;
    }
  }

  const commission: WbCommission = {
    byNm,
    avgPct: pctRevenue > 0 ? pctWeighted / pctRevenue : 0,
    avgAcqPct: acqRevenue > 0 ? acqWeighted / acqRevenue : 0,
    avgExtraPct: extraRevenue > 0 ? extraWeighted / extraRevenue : Number.NaN,
    overheadPct: overhead,
  };

  return {
    resolve(nmId: number): UnitNmRates {
      const rates = resolveWbRatesForNm(commission, nmId);
      return rates.factual
        ? {
            factual: true,
            marketplacePct: rates.marketplacePct,
            acquiringPct: rates.acquiringPct,
          }
        : unavailable();
    },
  };
}
