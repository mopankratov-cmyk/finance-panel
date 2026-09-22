import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/sync/helpers";
import { OPIU_BRANDS } from "@/lib/opiu/constants";
import { opiuReportRefreshPeriod, syncOpiuReportPeriod } from "@/lib/opiu/reportSync";
import { selectOpiuReportQueueCabinet, type OpiuReportQueueState } from "@/lib/opiu/reportSyncQueue";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

// Один вызов syncOpiuReportPeriod обрабатывает ограниченную порцию (см.
// MAX_PAGES_PER_CALL/SOFT_TIME_BUDGET_MS в lib/opiu/syncReportRows.ts —
// до 40 страниц или 3,5 минуты), поэтому 300с запаса хватает даже для
// самого крупного кабинета (Оптима, ~116k строк отчёта/день).
export const maxDuration = 300;

/**
 * Отдельный ручной триггер догрузки "отчёта о реализации" WB для ОПиУ —
 * тот же checkCronAuth, что и у остальных /api/sync/* (принимает как
 * Bearer CRON_SECRET, так и обычную сессию с ролью canRunSyncManually),
 * чтобы можно было просто открыть ссылку в браузере, как и для
 * advert-spend-history/paid-storage. Намеренно ОТДЕЛЬНО от
 * /api/opiu/monitor: тот же вызов там тянет за собой telegram-уведомления
 * и прогноз — не то, что хочется дёргать вручную несколько раз подряд.
 * Прогресс по каждому кабинету сохраняется в wb_sync_state (job
 * "opiu_report") — повторные вызовы продолжают, а не начинают заново.
 * Автоматический вызов берёт только один наиболее отстающий кабинет: один
 * тяжёлый кабинет способен занять почти весь 300-секундный бюджет функции,
 * а параллельный запуск всех кабинетов провоцировал сетевые обрывы WB.
 */
export async function GET(request: NextRequest) {
  const authError = await checkCronAuth(request);
  if (authError) return authError;

  const onlyCabinet = request.nextUrl.searchParams.get("cabinet");
  const uniqueCabinetIds = [...new Set(OPIU_BRANDS.map((b) => b.cabinetId))];

  if (onlyCabinet && !uniqueCabinetIds.includes(onlyCabinet)) {
    return NextResponse.json({ error: "Кабинет не найден среди OPIU_BRANDS" }, { status: 400 });
  }

  const period = opiuReportRefreshPeriod(new Date());
  let cabinetId = onlyCabinet;

  if (!cabinetId) {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
    const { data, error } = await db
      .from("wb_sync_state")
      .select("cabinet_id,status,state,updated_at")
      .in("cabinet_id", uniqueCabinetIds)
      .eq("job", "opiu_report");
    if (error) return NextResponse.json({ error: error.message }, { status: 502 });

    cabinetId = selectOpiuReportQueueCabinet(
      uniqueCabinetIds,
      (data ?? []).map((row) => ({
        cabinetId: String(row.cabinet_id),
        status: String(row.status ?? "pending"),
        updatedAt: row.updated_at ? String(row.updated_at) : null,
        state: (row.state ?? {}) as Record<string, unknown>,
      })) satisfies OpiuReportQueueState[],
      period,
    );
  }

  if (!cabinetId) return NextResponse.json({ error: "Нет кабинетов для синхронизации" }, { status: 503 });

  try {
    const result = { cabinetId, ...(await syncOpiuReportPeriod(period, cabinetId)) };
    return NextResponse.json({
      period,
      results: [result],
      deferredCabinetIds: uniqueCabinetIds.filter((id) => id !== cabinetId),
    });
  } catch (error) {
    const result = {
      cabinetId,
      error: error instanceof Error ? error.message : "Не удалось обновить финансовый отчёт WB",
    };
    // Vercel считает cron успешным только по HTTP-статусу. Возвращать 200 с
    // `error` в JSON опасно: зелёный запуск маскирует неподвижный курсор и
    // неполный отчёт Оптимы. Тело ответа сохраняем для диагностики, но сам
    // запуск явно помечаем как сбой внешнего источника.
    return NextResponse.json({
      period,
      results: [result],
      deferredCabinetIds: uniqueCabinetIds.filter((id) => id !== cabinetId),
    }, { status: 502 });
  }
}
