import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth, chunkedUpsert, writeSyncLog } from "@/lib/sync/helpers";
import { cabinetProductScope, getActiveWbCabinets } from "@/lib/wb/cabinetTokens";
import { getWbCommission } from "@/lib/wb/commissions";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { rotatingSyncTargets } from "@/lib/sync/rotation";

// Finance API допускает только один запрос в минуту (burst 1). Даже отчёт из
// одной страницы требует второй запрос через минуту, чтобы получить финальный
// 204, поэтому стандартных 60 секунд недостаточно для корректной пагинации.
export const maxDuration = 300;

// Наполняет wb_nm_commissions/wb_cabinet_commission_overhead — кэш факт-комиссии по nm,
// чтобы РНП/юнит не платили ~12с холодного финотчёта на каждый кабинет на каждом запросе
// (см. lib/wb/commissions.ts). Полный финотчёт одного большого кабинета занимает
// несколько минут, поэтому почасовой cron обходит кабинеты по кругу.
export async function GET(request: NextRequest) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  const startedAt = new Date();
  const allCabs = await getActiveWbCabinets();
  const onlyCabinet = request.nextUrl.searchParams.get("cabinet");
  const cabs = rotatingSyncTargets(allCabs, {
    requestedId: onlyCabinet,
    runAll: request.nextUrl.searchParams.get("all") === "1",
  });
  if (onlyCabinet && !cabs.length) {
    return NextResponse.json({ ok: false, error: "WB-кабинет не найден" }, { status: 404 });
  }
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
        throwOnError: true,
      });
      if (!comm.byNm.size) {
        errors.push(`${cab.name}: финотчёт не вернул ставки по SKU`);
        continue; // не затираем прошлый кэш нулями
      }
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
  return NextResponse.json({ ok, rows: total, cabinets: cabs.length, availableCabinets: allCabs.length, errors });
}
