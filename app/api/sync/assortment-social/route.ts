import { NextRequest, NextResponse } from "next/server";

import { UNLOCKER_TIMEOUT_MS, unlockerConfig, unlockerFetch } from "@/lib/assortment/brightdataUnlocker";
import { isMissingAssortmentSchema } from "@/lib/assortment/errors";
import { socialConfig } from "@/lib/assortment/socialReels";
import { runSocialReels, socialRunLog, type SocialPhase } from "@/lib/assortment/socialReelsStore";
import { checkCronAuth, writeSyncLog } from "@/lib/sync/helpers";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
// Страница через Web Unlocker — 4–20 с, до 6 параллельно (ASSORTMENT_SOCIAL_CONCURRENCY, не больше 8); новые запросы не начинаем позже
// BUDGET_MS − таймаут запроса; есть что мерить — поиск не начинает новых после своей доли этого окна (остаток после оценки времени замера,
// не меньше половины).
export const maxDuration = 300;

const JOB = "assortment-social";
const BUDGET_MS = 240_000;
const PHASES: readonly SocialPhase[] = ["discover", "measure", "match"];

/**
 * «Залетает в соцсетях» (решение владельца 06.10.2026): рилсы Instagram про Zara и Uniqlo, только женское. Крон каждые 3 часа
 * (vercel.json, в 20 минут каждого третьего часа UTC; с 07.10 — раз в сутки поиск занимал всё время прогона, и замер почти не шёл): поиск по темам /popular/ и
 * Google — раз в 6+ дней (незавершённый — доделывается следующими прогонами), профили наблюдаемых аккаунтов — когда им пора (раз в 6 дней),
 * замер постов 2–21 дня (первый — каждому, на 3-й и 7-й день — только рилсам с шансом), база автора, вердикт reels-v1, привязка
 * «залетевших» к модели каталога или карточке бренда. Два прогона разом не идут: замок в учёте (6 мин > maxDuration).
 *
 * Деньги: каждый запрос Bright Data — в учёт assortment_ai_usage (kind brightdata_social); потолки ASSORTMENT_SOCIAL_MAX_REQUESTS_PER_RUN
 * (150), дневная доля (седьмая часть строки в московские сутки — темп) и недельная строка соцсетей ASSORTMENT_SOCIAL_WEEKLY_USD ($3 ≈ 2 000
 * запросов; явный ASSORTMENT_SOCIAL_WEEKLY_REQUESTS сведён в неё же) в общем потолке движка проверяются до запроса.
 * Выключатель ASSORTMENT_SOCIAL=off. Ключ BRIGHTDATA_API_TOKEN, зона BRIGHTDATA_UNLOCKER_ZONE (по умолчанию mcp_unlocker).
 * Без миграции 202610060011 — тихо выходит с причиной; без ключа — строка-ошибка в журнале (сторож скажет через сутки — 8 ошибок подряд).
 * Прогон без единого запроса пишет метку [stop:idle]: сторож не считает его ни поломкой, ни починкой.
 * Деньги / ключ / зона Bright Data — остановка прогона одной причиной; сбой одной страницы прогон не роняет.
 *
 * `?dryRun=1` — посчитать, что пора делать, ничего не вызывая и не записывая. `?phase=discover|measure|match` — один шаг
 * (discover — поиск вне срока).
 */
export async function GET(request: NextRequest) {
  const authError = await checkCronAuth(request);
  if (authError) return authError;
  const startedAt = new Date();
  const params = request.nextUrl.searchParams;
  const dryRun = params.get("dryRun") === "1";
  const phaseParam = params.get("phase");
  const phase = PHASES.find((p) => p === phaseParam) ?? null;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 503 });
  try {
    const config = socialConfig();
    const unlocker = unlockerConfig();
    const summary = await runSocialReels(db, {
      config,
      hasKey: Boolean(unlocker.token),
      fetchPage: (url, format) => unlockerFetch(url, format, { config: unlocker }),
      phase,
      dryRun,
      deadlineMs: startedAt.getTime() + BUDGET_MS - UNLOCKER_TIMEOUT_MS,
    });
    const body = {
      dryRun, phase,
      config: { enabled: config.enabled, maxRequestsPerRun: config.maxRequestsPerRun, weeklyRequests: config.weeklyRequests, concurrency: config.concurrency, keyConfigured: Boolean(unlocker.token) },
      ...summary,
    };
    if (dryRun) return NextResponse.json({ ok: true, ...body });
    if (summary.skippedBecause === "off") {
      // Выключено намеренно — строка в журнале, чтобы сторож не принял тишину за поломку.
      await writeSyncLog(JOB, "ok", 0, summary.skipped, startedAt);
      return NextResponse.json({ ok: true, ...body });
    }
    if (summary.skippedBecause === "no_key") {
      await writeSyncLog(JOB, "error", null, summary.skipped, startedAt);
      return NextResponse.json({ ok: true, ...body });
    }
    if (summary.skippedBecause) return NextResponse.json({ ok: true, ...body });

    // Тревоги (вёрстка Instagram изменилась, поиск не завершается) — «ошибка», даже если запросы прошли: сторож скажет.
    const { status, note } = socialRunLog(summary);
    await writeSyncLog(JOB, status, summary.measured + summary.discover.newPosts, note, startedAt);
    return NextResponse.json({ ok: status !== "error", ...body }, { status: status === "error" ? 502 : 200 });
  } catch (error) {
    if (isMissingAssortmentSchema(error)) return NextResponse.json({ ok: true, skipped: "таблицы модуля не созданы" });
    const message = error instanceof Error ? error.message : "прогон не удался";
    await writeSyncLog(JOB, "error", null, message, startedAt);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
