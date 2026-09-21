import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/sync/helpers";
import { OPIU_BRANDS } from "@/lib/opiu/constants";
import { opiuReportRefreshPeriod, syncOpiuReportPeriod } from "@/lib/opiu/reportSync";

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
 */
export async function GET(request: NextRequest) {
  const authError = await checkCronAuth(request);
  if (authError) return authError;

  const onlyCabinet = request.nextUrl.searchParams.get("cabinet");
  const uniqueCabinetIds = [...new Set(OPIU_BRANDS.map((b) => b.cabinetId))]
    .filter((id) => !onlyCabinet || id === onlyCabinet);

  if (!uniqueCabinetIds.length) {
    return NextResponse.json({ error: "Кабинет не найден среди OPIU_BRANDS" }, { status: 400 });
  }

  const period = opiuReportRefreshPeriod(new Date());
  const results = await Promise.all(uniqueCabinetIds.map(async (cabinetId) => {
    try {
      const result = await syncOpiuReportPeriod(period, cabinetId);
      return { cabinetId, ...result };
    } catch (error) {
      return {
        cabinetId,
        error: error instanceof Error ? error.message : "Не удалось обновить финансовый отчёт WB",
      };
    }
  }));

  return NextResponse.json({ period, results });
}
