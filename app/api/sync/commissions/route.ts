import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth, chunkedUpsert, writeSyncLog } from "@/lib/sync/helpers";
import { cabinetProductScope, getActiveWbCabinets } from "@/lib/wb/cabinetTokens";
import { getWbCommission } from "@/lib/wb/commissions";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const maxDuration = 60;

// Наполняет wb_nm_commissions/wb_cabinet_commission_overhead — кэш факт-комиссии по nm,
// чтобы РНП/юнит не платили ~12с холодного финотчёта на каждый кабинет на каждом запросе
// (см. lib/wb/commissions.ts). Best-effort: если не успел за один слот (много кабинетов),
// недостающие кабинеты подхватит live-фолбэк там же — это чистая оптимизация, не хард-зависимость.
export async function GET(request: NextRequest) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  const startedAt = new Date();
  const cabs = await getActiveWbCabinets();
  if (!cabs.length) return NextResponse.json({ ok: true, rows: 0, cabinets: 0 });

  const db = getSupabaseAdmin();
  let total = 0;
  const errors: string[] = [];

  for (const cab of cabs) {
    try {
      const comm = await getWbCommission(30, {
        token: cab.token,
        cacheKey: cab.id,
        scope: cabinetProductScope(cab),
      });
      if (!comm.byNm.size) continue; // токен без прав/пусто — не затираем прошлый кэш нулями
      const synced_at = new Date().toISOString();
      const rows = [...comm.byNm.entries()].map(([nm_id, r]) => ({
        cabinet_id: cab.id, nm_id, pct: r.pct, acq_pct: r.acqPct, extra_pct: r.extraPct, rev: r.rev, synced_at,
      }));
      const totalRev = rows.reduce((s, r) => s + r.rev, 0);

      const upsertErr = await chunkedUpsert("wb_nm_commissions", rows, "cabinet_id,nm_id");
      if (upsertErr) { errors.push(`${cab.name}: ${upsertErr}`); continue; }

      if (db) {
        await db.from("wb_cabinet_commission_overhead").upsert(
          { cabinet_id: cab.id, overhead_pct: comm.overheadPct, rev: totalRev, synced_at },
          { onConflict: "cabinet_id" },
        );
      }
      total += rows.length;
    } catch (err) {
      errors.push(`${cab.name}: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }

  const ok = errors.length === 0;
  await writeSyncLog("commissions", ok ? "ok" : "error", total, errors.join("; ") || null, startedAt);
  return NextResponse.json({ ok, rows: total, cabinets: cabs.length, errors });
}
