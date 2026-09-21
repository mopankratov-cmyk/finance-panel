import { NextRequest, NextResponse } from "next/server";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { resolveCabinetSelection } from "@/lib/cabinetGroups";
import { UNRELIABLE_WINDOWS, dailyPoints, type HistoryRow } from "@/lib/supplies/stockHistory";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { requestAllowedNmIds, requestAllowsNm } from "@/lib/wb/requestProductScope";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Сколько снимки хранятся — столько же, сколько чистит ночной крон (app/api/sync/stocks-history-cleanup). */
const RETENTION_DAYS = 90;
const PERIODS = [7, 30, 90];

const fail = (error: string, status: number) => NextResponse.json({ data: null, error }, { status });

/**
 * История остатка одного артикула — по снимкам `wb_stocks_history`.
 *
 * Снимок раз в четыре часа делает крон stocks-history, но до сих пор никто эту
 * таблицу не читал: экран показывал только текущий остаток. Здесь снимки
 * сводятся к последнему за каждые московские сутки (lib/supplies/stockHistory.ts),
 * а выбор складов накладывает уже экран — поэтому по каждому дню отдаётся
 * разбивка по складам, а не готовая сумма.
 */
export async function GET(request: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);

  const params = new URL(request.url).searchParams;
  const nmId = Number(params.get("nm"));
  if (!Number.isInteger(nmId) || nmId <= 0) return fail("Укажите артикул WB (nm)", 400);
  const requestedDays = Number(params.get("days") ?? 30);
  const days = PERIODS.includes(requestedDays) ? requestedDays : 30;

  const { single, members } = await resolveCabinetSelection(params.get("cabinet"));
  // Доступ и товарный контур — ровно те же, что у списка остатков (/api/supplies):
  // история не должна показывать артикул, которого нет в самом списке.
  const accessAllowed = members
    ? (await Promise.all(members.map((member) => hasCabinetAccess(member)))).every(Boolean)
    : await hasCabinetAccess(single);
  if (!accessAllowed) return fail("Нет доступа к кабинету", 403);

  const scopeCabinets = members ?? (single ? [single] : []);
  const scopes = new Map(await Promise.all(scopeCabinets.map(async (cabinet) => [cabinet, await requestAllowedNmIds(cabinet)] as const)));
  const visibleCabinets = scopeCabinets.filter((cabinet) => requestAllowsNm(scopes.get(cabinet) ?? null, nmId));
  if (scopeCabinets.length && !visibleCabinets.length) return fail("Артикул не входит в товарный контур кабинета", 404);

  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  try {
    const [rows, runsResult] = await Promise.all([
      loadAllSupabasePages<HistoryRow>((from, to) => {
        let query = db.from("wb_stocks_history")
          .select("snapshot_at, warehouse, quantity, in_way_to_client, in_way_from_client")
          .eq("nm_id", nmId)
          .gte("snapshot_at", since)
          .order("snapshot_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to);
        if (scopeCabinets.length) query = query.in("cabinet_id", visibleCabinets);
        return query;
      }, { label: "История остатков WB", maxPages: 45, concurrency: 4 }),
      // Журнал крона: какие снимки вообще были. Без него нулевой остаток не
      // отличить от снимка, которого не делали (строки с нулём не пишутся).
      db.from("sync_log").select("started_at").eq("job", "stocks-history").eq("status", "ok").gte("started_at", since).order("started_at", { ascending: true }).limit(1000),
    ]);
    const runs = runsResult.error ? [] : (runsResult.data ?? []).map((row) => String(row.started_at));
    const points = dailyPoints(rows, runs);
    return NextResponse.json({
      data: {
        nmId,
        days,
        points,
        /** false — журнал крона недоступен, нулевые дни в истории могут быть пропусками. */
        journal: !runsResult.error && runs.length > 0,
        retentionDays: RETENTION_DAYS,
        unreliable: UNRELIABLE_WINDOWS,
      },
      error: null,
    });
  } catch (cause) {
    return fail(cause instanceof Error ? cause.message : "Не удалось прочитать историю остатков", 500);
  }
}
