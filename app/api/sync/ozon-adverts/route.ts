import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth, writeSyncLog } from "@/lib/sync/helpers";
import { isOzonPerformanceReportDeferredMessage, perfProductReport } from "@/lib/ozon/performance";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { rotatingSyncTargets } from "@/lib/sync/rotation";

export const maxDuration = 60;

type OzonCabinet = {
  id: string;
  name: string;
  client_id: string;
  perf_client_id: string | null;
  perf_secret: string | null;
};

// Ozon analytics/stocks читаются из почасовых снимков. Эта задача каждый час
// обновляет Performance-рекламу. Один async-отчёт Ozon может занимать до 45с,
// поэтому почасовой cron обрабатывает кабинеты по кругу; ручной ?all=1 оставлен
// для окружений с увеличенным лимитом функции.
export async function GET(request: NextRequest) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  const startedAt = new Date();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 503 });

  const { data, error } = await db
    .from("wb_cabinets")
    .select("id, name, client_id, perf_client_id, perf_secret")
    .eq("marketplace", "ozon")
    .eq("is_active", true);
  if (error) {
    await writeSyncLog("ozon-adverts", "error", 0, error.message, startedAt);
    return NextResponse.json({ ok: false, error: error.message }, { status: 502 });
  }

  const allCabinets = (data ?? []) as OzonCabinet[];
  const requestedId = request.nextUrl.searchParams.get("cabinet");
  const cabinets = rotatingSyncTargets(allCabinets, {
    requestedId,
    runAll: request.nextUrl.searchParams.get("all") === "1",
  });
  if (requestedId && !cabinets.length) {
    return NextResponse.json({ ok: false, error: "Ozon-кабинет не найден" }, { status: 404 });
  }
  const to = new Date().toISOString();
  const from = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const results = await Promise.all(cabinets.map(async (cabinet) => {
    try {
      if (!cabinet.client_id || !cabinet.perf_client_id || !cabinet.perf_secret) {
        throw new Error("Нет Ozon Performance API");
      }
      const report = await perfProductReport(
        { clientId: cabinet.perf_client_id, secret: cabinet.perf_secret },
        from,
        to,
        60,
        { throwOnError: true },
      );
      if (!report) throw new Error("Performance report failed");

      const rows = Object.entries(report.bySku).map(([sku, value]) => ({
        client_id: cabinet.client_id,
        sku,
        days: 14,
        spent: Math.round(value.spent),
        orders_money: Math.round(value.ordersMoney),
        updated_at: new Date().toISOString(),
      }));
      if (rows.length) {
        const { error: upsertError } = await db
          .from("ozon_ad_cache")
          .upsert(rows, { onConflict: "client_id,sku,days" });
        if (upsertError) throw new Error(upsertError.message);
      }
      return {
        cabinet: cabinet.name,
        ok: true,
        rows: rows.length,
        partial: report.partial,
        deferred: false,
        error: report.errors.length ? report.errors.join("; ") : null,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return {
        cabinet: cabinet.name,
        ok: false,
        rows: 0,
        partial: false,
        deferred: isOzonPerformanceReportDeferredMessage(message),
        error: message,
      };
    }
  }));

  const deferred = results.filter((result) => !result.ok && result.deferred);
  const failures = results.filter((result) => !result.ok && !result.deferred);
  const total = results.reduce((sum, result) => sum + result.rows, 0);
  const partial = results.filter((result) => result.partial).map((result) => result.cabinet);
  const notes = [
    ...failures.map((result) => `${result.cabinet}: ${result.error ?? "Ozon API error"}`),
    ...deferred.map((result) => `${result.cabinet}: Ozon Performance готовит отчёт или ограничил частоту, повторим автоматически (${result.error ?? "retry later"})`),
    ...results.filter((result) => result.ok && result.error).map((result) => `${result.cabinet}: ${result.error}`),
    ...(partial.length ? [`Частичный Performance-отчёт: ${partial.join(", ")}`] : []),
  ];
  const ok = failures.length === 0;
  await writeSyncLog("ozon-adverts", ok ? "ok" : "error", total, notes.join("; ") || null, startedAt);
  return NextResponse.json(
    { ok, rows: total, cabinets: cabinets.length, availableCabinets: allCabinets.length, results, warnings: [...partial, ...deferred.map((result) => result.cabinet)] },
    { status: ok ? 200 : 502 },
  );
}
