import { NextRequest, NextResponse } from "next/server";

import { makeChinaCaller } from "@/lib/assortment/china1688";
import { CHINA_JOB, chinaConfig, chinaRunLog, chinaTranslatorFromEnv, runChinaSnapshot, type ChinaPhase } from "@/lib/assortment/chinaSync";
import { isMissingAssortmentSchema } from "@/lib/assortment/errors";
import { checkCronAuth, writeSyncLog } from "@/lib/sync/helpers";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
// Поиск 1688 отвечает за 4–7 с, между вызовами пауза 3 с: за прогон — около 25 вызовов. Новых вызовов не начинаем позже
// BUDGET_MS − худший случай вызова (таймаут × 2 + пауза повтора); перевод названий — только если осталось время.
export const maxDuration = 300;

const BUDGET_MS = 270_000;
const PHASES: readonly ChinaPhase[] = ["niches", "articles", "trends"];

/**
 * «Китай (1688)» (решение владельца 07.10.2026): недельный снимок через официальные ИИ-навыки 1688. Крон дважды в сутки (vercel.json,
 * 05:35 и 11:35 UTC), работает только пока снимок недели (с понедельника по Москве) не завершён: топ каждой ниши, копии по номерам товаров
 * Zara и Uniqlo из рилсов за 30 дней, тренды ключей и «возможности»; затем перевод новых названий топа (Polza, общий потолок движка).
 * Готовый снимок — ответ без строки в журнале.
 *
 * Ключ — ALI_1688_AK (как у официальных навыков). Без ключа — строка-ошибка в журнале и блок на экране скрыт; ключ не принят (401 /
 * SignatureInvalid) — остановка одной причиной; 429 / Qos* — пауза без траты попыток. Без миграции 202610070001 — тихий выход с причиной;
 * без строки S104 в assortment_sources (там прогресс недели) — прогон не начинается, строка-ошибка в журнале.
 * Выключатель ASSORTMENT_CHINA=off. Потолки: ASSORTMENT_CHINA_MAX_CALLS_PER_RUN (40), ASSORTMENT_CHINA_WEEKLY_CALLS (150).
 *
 * `?dryRun=1` — что пора сделать, ничего не вызывая и не записывая; `?phase=niches|articles|trends` — только этот шаг недели.
 */
export async function GET(request: NextRequest) {
  const authError = await checkCronAuth(request);
  if (authError) return authError;
  const startedAt = new Date();
  const params = request.nextUrl.searchParams;
  const dryRun = params.get("dryRun") === "1";
  const phaseParam = params.get("phase");
  const phase = PHASES.find((p) => p === phaseParam) ?? null;
  if (phaseParam && !phase) return NextResponse.json({ ok: false, error: "phase должен быть niches, articles или trends" }, { status: 400 });
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 503 });
  try {
    const config = chinaConfig();
    const translator = chinaTranslatorFromEnv();
    const summary = await runChinaSnapshot(db, {
      config,
      call: makeChinaCaller(),
      translator,
      phase,
      dryRun,
      deadlineMs: startedAt.getTime() + BUDGET_MS,
    });
    const body = {
      dryRun, phase,
      config: { enabled: config.enabled, maxCallsPerRun: config.maxCallsPerRun, weeklyCalls: config.weeklyCalls, refsPerWeek: config.refsPerWeek, translateModel: translator.model },
      ...summary,
    };
    if (dryRun) return NextResponse.json({ ok: true, ...body });
    if (summary.skippedBecause === "off") {
      await writeSyncLog(CHINA_JOB, "ok", 0, summary.skipped, startedAt);
      return NextResponse.json({ ok: true, ...body });
    }
    // Нет ключа или строки S104 (прогресс недели негде хранить) — ошибка в журнале каждым прогоном: сторож поднимет тревогу.
    if (summary.skippedBecause === "no_key" || summary.skippedBecause === "no_state") {
      await writeSyncLog(CHINA_JOB, "error", null, summary.skipped, startedAt);
      return NextResponse.json({ ok: true, ...body });
    }
    if (summary.skippedBecause) return NextResponse.json({ ok: true, ...body });

    const { status, note } = chinaRunLog(summary);
    await writeSyncLog(CHINA_JOB, status, summary.rows + summary.translated, note, startedAt);
    return NextResponse.json({ ok: status !== "error", ...body }, { status: status === "error" ? 502 : 200 });
  } catch (error) {
    if (isMissingAssortmentSchema(error)) return NextResponse.json({ ok: true, skipped: "таблицы модуля не созданы" });
    const message = error instanceof Error ? error.message : "прогон не удался";
    await writeSyncLog(CHINA_JOB, "error", null, message, startedAt);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
