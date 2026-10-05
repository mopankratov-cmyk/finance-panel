import { NextRequest, NextResponse } from "next/server";

import { catalogAiConfig, polzaKey, PROVIDER_KEY_NAME, PROVIDER_LABEL } from "@/lib/assortment/catalogAi";
import { aiKeyConfigured, askFor, runCatalogAi } from "@/lib/assortment/catalogAiStore";
import { checkCronAuth, writeSyncLog } from "@/lib/sync/helpers";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
// Один вызов с двумя фото — 3–6 с, пачка по три; новую пачку не начинаем позже 150-й секунды (таймаут вызова 45 с).
export const maxDuration = 300;

const JOB = "assortment-catalog-ai";

/**
 * Признаки по фото для моделей каталога (движок тенденций, этап 2): дешёвая модель
 * (Haiku напрямую у Anthropic либо любая из таблицы цен через Polza — провайдер по
 * ASSORTMENT_CATALOG_AI_PROVIDER или по тому, какой ключ есть), до двух фото на
 * модель, ответ — те же признаки, что у находок. Расход (у Polza — списанные рубли
 * из ответа по курсу, у Anthropic — токены по цене) пишется в assortment_ai_usage; бюджет недели
 * (ASSORTMENT_CATALOG_AI_WEEKLY_BUDGET_USD, по умолчанию $20 из $30 на весь движок; считает только этот сборщик) и
 * потолок моделей в сутки (ASSORTMENT_CATALOG_AI_DAILY_LIMIT, 300) проверяются
 * ДО каждой пачки. Выключатель: ASSORTMENT_CATALOG_AI=off. Без ключа выбранного
 * провайдера (при непустой очереди — строка-ошибка в журнале), без миграции или
 * без цены модели — прогон пропускается.
 *
 * `?dryRun=1` — посчитать очередь и разрешённый объём, ничего не вызывая.
 */
export async function GET(request: NextRequest) {
  const authError = await checkCronAuth(request);
  if (authError) return authError;
  const startedAt = new Date();
  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 503 });
  try {
    const config = catalogAiConfig();
    const ask = askFor(config);
    const keyConfigured = aiKeyConfigured(config.provider);
    // Провайдер не задан и ключей нет совсем — называем оба варианта, а не только Anthropic.
    const noKeysAtAll = !config.providerForced && !aiKeyConfigured("anthropic") && !aiKeyConfigured("polza");
    const keyName = noKeysAtAll ? "ИИ (ANTHROPIC_API_KEY или POLZA_API_KEY)" : `${PROVIDER_LABEL[config.provider]} (${PROVIDER_KEY_NAME[config.provider]})`;
    if (!keyConfigured && !dryRun) {
      // Без ключа платить нечем, но молчать нельзя: если очередь не пуста, это строка-ошибка в журнале — и сторож
      // служебных задач скажет в Telegram через три прогона, а не «выложили, а признаков нет».
      const probe = await runCatalogAi(db, { ask, config, dryRun: true });
      if (!probe.skipped && probe.allowed > 0) {
        await writeSyncLog(JOB, "error", null, `нет ключа ${keyName}: ${probe.candidates} моделей ждут разбора`, startedAt);
      }
      return NextResponse.json({ ok: true, skipped: `нет ключа ${keyName}`, provider: config.provider, waiting: probe.candidates });
    }
    const summary = await runCatalogAi(db, { ask, config, dryRun });
    // Модель без цены — ошибка настройки: молча её не оставляем (строка в журнале, сторож скажет в Telegram через три прогона).
    if (!dryRun && summary.skippedBecause === "no_price") await writeSyncLog(JOB, "error", null, summary.skipped, startedAt);
    if (dryRun || summary.skipped || summary.candidates === 0) {
      return NextResponse.json({ ok: true, dryRun, keyConfigured, config: { provider: config.provider, model: config.model, weeklyBudgetUsd: config.weeklyBudgetUsd, dailyLimit: config.dailyLimit, enabled: config.enabled, priced: Boolean(config.price) }, ...summary });
    }

    // Лимит запросов при уже разобранных моделях — это «медленнее», а не «сломалось» (низкий тариф Anthropic упирается в
    // токены в минуту): прогон «partial» и три таких подряд тревогу не дают. Без единой разобранной — «error».
    const rateLimited = summary.stoppedBy === "rate_limit";
    const hardStop = summary.stoppedBy === "auth" || summary.stoppedBy === "billing" || summary.stoppedBy === "config" || summary.stoppedBy === "errors" || (rateLimited && summary.done === 0);
    // Провайдер выбран по ключу (Anthropic раньше Polza), Anthropic остановился по ключу/деньгам, а ключ Polza есть:
    // подсказываем явное переключение, чтобы владелец не искал причину.
    const switchHint = config.provider === "anthropic" && !config.providerForced && polzaKey() && (summary.stoppedBy === "auth" || summary.stoppedBy === "billing")
      ? "Задан и POLZA_API_KEY: укажите ASSORTMENT_CATALOG_AI_PROVIDER=polza"
      : null;
    const note = [
      summary.stopMessage,
      switchHint,
      summary.failed > 0 ? `не разобрано: ${summary.failed}` : null,
      summary.transient > 0 ? `временных сбоев (перегрузка, сеть): ${summary.transient}` : null,
      summary.deadSources.length > 0 ? `фото не скачиваются, источники пропущены: ${summary.deadSources.join(", ")}` : null,
      summary.stoppedBy === "budget" ? "дошли до бюджета недели или потолка суток" : null,
    ].filter(Boolean).join(". ");
    // «error» — ИИ не принял ключ/нет денег/лимит или не вышло ничего; упёрлись во время или в бюджет — ожидаемо, «partial»/«ok».
    const status = hardStop || (summary.done === 0 && summary.failed + summary.transient > 0) ? "error" : summary.failed > 0 || summary.stoppedBy === "time" || rateLimited || summary.deadSources.length > 0 ? "partial" : "ok";
    await writeSyncLog(JOB, status, summary.done, note || null, startedAt);
    return NextResponse.json({ ok: status !== "error", ...summary }, { status: status === "error" ? 502 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "разбор не удался";
    await writeSyncLog(JOB, "error", null, message, startedAt);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
