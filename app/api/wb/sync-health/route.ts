import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireApiSession } from "@/lib/auth/apiGuard";
import { sessionHasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { getServerSession } from "@/lib/auth/server";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { wbSyncHealthStatus } from "@/lib/sync/wbSyncHealthStatus";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getActiveWbCabinets } from "@/lib/wb/cabinetTokens";
import { normalizeWbBrand } from "@/lib/wb/productScope";
import { WB_SCOPE_LABEL, type WbScope } from "@/lib/wb/token";

export const dynamic = "force-dynamic";

interface ScopeRow { cabinet_id: string; nm_id: number; brand: string | null }
interface StateRow { cabinet_id: string; job: string; cursor: string | null; status: string; attempts: number; last_error: string | null; state: Record<string, unknown>; updated_at: string }
interface TokenRow { cabinet_id: string; scope: WbScope; available: boolean | null; expires_at: string | null; days_left: number | null; checked_at: string; last_error: string | null }

const SOURCE_SLA_MINUTES: Record<string, number> = {
  orders: 90,
  sales: 90,
  stocks: 90,
  adverts: 90,
  "advert-stats": 180,
  funnel: 360,
  feedbacks: 180,
  commissions: 26 * 60,
};

async function sourceSnapshot(db: SupabaseClient, cabinetId: string, table: string, timestamp: string) {
  const result = await db
    .from(table)
    .select(timestamp, { count: "exact" })
    .eq("cabinet_id", cabinetId)
    .order(timestamp, { ascending: false })
    .limit(1);
  return {
    rows: result.count ?? 0,
    lastSyncedAt: result.error ? null : String(((result.data?.[0] as unknown) as Record<string, unknown> | undefined)?.[timestamp] ?? "") || null,
    error: result.error?.message ?? null,
  };
}

export async function GET() {
  const gate = await requireApiSession();
  if (gate) return gate;
  const session = await getServerSession();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const cabinets = (await getActiveWbCabinets()).filter((cabinet) => sessionHasCabinetAccess(session, cabinet.id));
  const cabinetIds = cabinets.map((cabinet) => cabinet.id);
  if (!cabinetIds.length) return NextResponse.json({ generatedAt: new Date().toISOString(), cabinets: [], warnings: [] });

  const warnings: string[] = [];
  let scopeRows: ScopeRow[] = [];
  try {
    scopeRows = await loadAllSupabasePages<ScopeRow>((from, to) => db
      .from("wb_cabinet_product_scope")
      .select("cabinet_id, nm_id, brand")
      .in("cabinet_id", cabinetIds)
      .order("cabinet_id", { ascending: true })
      .order("nm_id", { ascending: true })
      .range(from, to), { maxPages: 1_000, label: "Диагностика товарного контура" });
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : "Не удалось прочитать товарный контур");
  }
  const [statesResult, tokensResult] = await Promise.all([
    db.from("wb_sync_state").select("cabinet_id, job, cursor, status, attempts, last_error, state, updated_at").in("cabinet_id", cabinetIds).order("updated_at", { ascending: false }),
    db.from("wb_token_health").select("cabinet_id, scope, available, expires_at, days_left, checked_at, last_error").in("cabinet_id", cabinetIds).order("checked_at", { ascending: false }),
  ]);
  if (statesResult.error) warnings.push(statesResult.error.message);
  if (tokensResult.error) warnings.push("Проверка токенов ещё не развёрнута или временно недоступна");
  const states = (statesResult.data ?? []) as StateRow[];
  const tokens = (tokensResult.data ?? []) as TokenRow[];

  const result = await Promise.all(cabinets.map(async (cabinet) => {
    const cabinetScope = scopeRows.filter((row) => row.cabinet_id === cabinet.id);
    const uniqueNm = new Set(cabinetScope.map((row) => Number(row.nm_id)));
    const byBrand = cabinetScope.reduce<Record<string, number>>((acc, row) => {
      const brand = normalizeWbBrand(row.brand) || "unknown";
      acc[brand] = (acc[brand] ?? 0) + 1;
      return acc;
    }, {});
    const sources = await Promise.all([
      sourceSnapshot(db, cabinet.id, "wb_orders", "synced_at").then((value) => ({ job: "orders", ...value })),
      sourceSnapshot(db, cabinet.id, "wb_sales", "synced_at").then((value) => ({ job: "sales", ...value })),
      sourceSnapshot(db, cabinet.id, "wb_stocks", "synced_at").then((value) => ({ job: "stocks", ...value })),
      sourceSnapshot(db, cabinet.id, "wb_adverts", "synced_at").then((value) => ({ job: "adverts", ...value })),
      sourceSnapshot(db, cabinet.id, "wb_advert_stats", "date").then((value) => ({ job: "advert-stats", ...value })),
      sourceSnapshot(db, cabinet.id, "wb_funnel_daily", "date").then((value) => ({ job: "funnel", ...value })),
      sourceSnapshot(db, cabinet.id, "wb_feedbacks", "synced_at").then((value) => ({ job: "feedbacks", ...value })),
      sourceSnapshot(db, cabinet.id, "wb_nm_commissions", "synced_at").then((value) => ({ job: "commissions", ...value })),
    ]);
    const cabinetStates = states.filter((state) => state.cabinet_id === cabinet.id);
    const stateByJob = new Map(cabinetStates.map((state) => [state.job, state]));
    return {
      id: cabinet.id,
      name: cabinet.name,
      brands: cabinet.brand_filters,
      scope: {
        restricted: cabinet.allowed_nm_ids !== null,
        total: uniqueNm.size,
        allowed: cabinet.allowed_nm_ids?.length ?? null,
        norvia: byBrand.norvia ?? 0,
        rioBox: byBrand.riobox ?? 0,
        updatedAt: stateByJob.get("product-scope")?.updated_at ?? null,
      },
      tokens: tokens.filter((token) => token.cabinet_id === cabinet.id).map((token) => ({
        scope: token.scope,
        label: WB_SCOPE_LABEL[token.scope],
        available: token.available,
        expiresAt: token.expires_at,
        daysLeft: token.days_left,
        checkedAt: token.checked_at,
        error: token.last_error,
      })),
      sources: sources.map((source) => {
        const state = stateByJob.get(source.job);
        const stateLastSyncedAt = typeof state?.state?.lastSyncedAt === "string" ? state.state.lastSyncedAt : null;
        const lastSyncedAt = stateLastSyncedAt || source.lastSyncedAt || state?.updated_at || null;
        const ageMinutes = lastSyncedAt
          ? Math.max(0, Math.round((Date.now() - new Date(lastSyncedAt).getTime()) / 60_000))
          : null;
        const slaMinutes = SOURCE_SLA_MINUTES[source.job] ?? 90;
        const stale = ageMinutes !== null && ageMinutes > slaMinutes;
        const progressStatus = state?.status;
        const health = wbSyncHealthStatus({
          sourceError: source.error,
          progressStatus,
          stateLastError: state?.last_error ?? null,
          stale,
          hasLastSyncedAt: Boolean(lastSyncedAt),
        });
        return {
          ...source,
          lastSyncedAt,
          status: health.status,
          stale,
          ageMinutes,
          slaMinutes,
          cursor: state?.cursor ?? null,
          attempts: state?.attempts ?? 0,
          coveragePct: Number(state?.state?.coveragePct ?? (source.lastSyncedAt ? 100 : 0)),
          stateUpdatedAt: state?.updated_at ?? null,
          lastError: health.lastError,
        };
      }),
    };
  }));

  return NextResponse.json({ generatedAt: new Date().toISOString(), cabinets: result, warnings: [...new Set(warnings)] });
}
