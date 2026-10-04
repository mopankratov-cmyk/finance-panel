import { NextRequest, NextResponse } from "next/server";

import { catalogAiConfig } from "@/lib/assortment/catalogAi";
import { aiKeyConfigured, askAnthropicVision, runCatalogAi } from "@/lib/assortment/catalogAiStore";
import { checkCronAuth, writeSyncLog } from "@/lib/sync/helpers";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
// Один вызов с двумя фото — 3–6 с, пачка по три; новую пачку не начинаем позже 150-й секунды (таймаут вызова 45 с).
export const maxDuration = 300;

const JOB = "assortment-catalog-ai";

/**
 * Признаки по фото для моделей каталога (движок тенденций, этап 2): дешёвая модель
 * (Haiku), до двух фото на модель, ответ — те же признаки, что у находок. Расход
 * считается по токенам из ответа и пишется в assortment_ai_usage; бюджет недели
 * (ASSORTMENT_CATALOG_AI_WEEKLY_BUDGET_USD, по умолчанию $20 из $30 на весь движок; считает только этот сборщик) и
 * потолок моделей в сутки (ASSORTMENT_CATALOG_AI_DAILY_LIMIT, 300) проверяются
 * ДО каждой пачки. Выключатель: ASSORTMENT_CATALOG_AI=off. Без ключа Anthropic,
 * без миграции или без цены модели — прогон молча пропускается.
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
  if (!aiKeyConfigured() && !dryRun) return NextResponse.json({ ok: true, skipped: "нет ключа Anthropic (ANTHROPIC_API_KEY)" });

  try {
    const config = catalogAiConfig();
    const summary = await runCatalogAi(db, { ask: askAnthropicVision, config, dryRun });
    if (dryRun || summary.skipped || summary.candidates === 0) return NextResponse.json({ ok: true, dryRun, config: { model: config.model, weeklyBudgetUsd: config.weeklyBudgetUsd, dailyLimit: config.dailyLimit, enabled: config.enabled, priced: Boolean(config.price) }, ...summary });

    const hardStop = summary.stoppedBy === "auth" || summary.stoppedBy === "billing" || summary.stoppedBy === "rate_limit" || summary.stoppedBy === "config" || summary.stoppedBy === "errors";
    const note = [
      summary.stopMessage,
      summary.failed > 0 ? `не разобрано: ${summary.failed}` : null,
      summary.transient > 0 ? `временных сбоев (перегрузка, сеть): ${summary.transient}` : null,
      summary.stoppedBy === "budget" ? "дошли до бюджета недели или потолка суток" : null,
    ].filter(Boolean).join(". ");
    // «error» — ИИ не принял ключ/нет денег/лимит или не вышло ничего; упёрлись во время или в бюджет — ожидаемо, «partial»/«ok».
    const status = hardStop || (summary.done === 0 && summary.failed + summary.transient > 0) ? "error" : summary.failed > 0 || summary.stoppedBy === "time" ? "partial" : "ok";
    await writeSyncLog(JOB, status, summary.done, note || null, startedAt);
    return NextResponse.json({ ok: status !== "error", ...summary }, { status: status === "error" ? 502 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "разбор не удался";
    await writeSyncLog(JOB, "error", null, message, startedAt);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
