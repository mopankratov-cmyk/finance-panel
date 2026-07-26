import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/sync/helpers";
import { runCoreSyncJobs, WB_HOURLY_CORE_SYNC_OPTIONS } from "@/lib/sync/orchestrator";
import { runWbHistoryRecovery } from "@/lib/wb/syncRecovery";

// Оркестратор быстрых синков и восстановления глубокой истории — один cron-слот
// и кнопка
// «Обновить WB». sales/stocks не запускаем здесь: у WB seller-wide limiter,
// поэтому они идут отдельными слотами :02/:04. funnel/commissions/feedbacks сюда НЕ входят — funnel сама по себе
// таймбоксится на 50с (21с-паузы между батчами analytics-API), и раньше съедала весь
// бюджет функции, из-за чего commissions/feedbacks не запускались НИ РАЗУ (см. аудит
// данных/API 2026-07-08). Вынесены в отдельные cron-слоты: /api/sync/funnel напрямую
// и /api/sync/all-2 (commissions+feedbacks) — см. vercel.json.
// AI-инсайты здесь намеренно не строим: live-фолбэк комиссии скачивал два отчёта
// WB на десятки МБ и стабильно выбивал весь /all за 60с. Правиловые сигналы имеют
// отдельный cron /api/signals?persist=1.

// Глубокая история загружает и распаковывает DETAIL_HISTORY_REPORT. На боевых
// кабинетах она регулярно выходит за минуту, хотя быстрые дочерние синки уже
// завершились. Держим тот же бюджет, что и у других тяжёлых WB-отчётов.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  const secret = process.env.CRON_SECRET;
  const base = new URL(request.url).origin;
  const headers: Record<string, string> = secret ? { Authorization: `Bearer ${secret}` } : {};

  const [result, history] = await Promise.all([
    runCoreSyncJobs(base, headers, fetch, WB_HOURLY_CORE_SYNC_OPTIONS),
    runWbHistoryRecovery(),
  ]);
  const ok = result.ok && history.ok;
  return NextResponse.json(
    { ok, results: { ...result.results, history } },
    { status: ok ? 200 : 502 },
  );
}
