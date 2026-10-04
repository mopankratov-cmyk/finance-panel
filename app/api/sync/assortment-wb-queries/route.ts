import { NextRequest, NextResponse } from "next/server";

import { hasMpstats, mpstatsWbQuota, subjectKeywordsFull } from "@/lib/mpstats/client";
import { planSnapshots, WB_SUBJECTS } from "@/lib/assortment/wbQueries";
import { collectWbQuerySnapshots, loadSnapshotMeta } from "@/lib/assortment/wbQueriesStore";
import { checkCronAuth, writeSyncLog } from "@/lib/sync/helpers";
import { closedMoscowDates } from "@/lib/wb/sklejki";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
// Один ответ MPSTATS — до 85 с на попытку (две — 171 с); новый предмет не начинаем позже 60-й секунды:
// 60 + 171 + запрос квоты 10 с + запись в базу остаются в пределах 300 с.
export const maxDuration = 300;
const START_BUDGET_MS = 60_000;
const ROTATION_STEP_MS = 6 * 3600 * 1000;

const JOB = "assortment-wb-queries";
/** Квота WB-запросов MPSTATS общая с /market, «Пульсом», «Нишами» и планом продаж: ниже запаса не трогаем. */
const QUOTA_RESERVE = 100;

/**
 * Недельный сбор частотности запросов WB по предметам-силуэтам раздела
 * (lib/assortment/wbQueries.ts) в assortment_wb_query_snapshot. Крон запускается
 * несколько раз в сутки: что пора снимать (раз в 7 дней на предмет), снимает по
 * одному предмету за раз в пределах времени функции, остальное — следующим
 * запуском; когда снимать нечего, MPSTATS не вызывается совсем.
 *
 * `?dryRun=1` — только показать план, ничего не снимать. `?subject=<id>` — только
 * один предмет.
 */
export async function GET(request: NextRequest) {
  const authError = await checkCronAuth(request);
  if (authError) return authError;
  const startedAt = new Date();
  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";
  const only = Number(request.nextUrl.searchParams.get("subject"));
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 503 });
  if (!hasMpstats()) return NextResponse.json({ ok: true, skipped: "MPSTATS не подключён в окружении" });

  const fail = async (error: string, status = 502) => {
    if (!dryRun) await writeSyncLog(JOB, "error", null, error, startedAt);
    return NextResponse.json({ ok: false, error }, { status });
  };

  let existing;
  try {
    existing = await loadSnapshotMeta(db);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Срезы не прочитались");
  }
  if (existing === null) return NextResponse.json({ ok: true, skipped: "нет таблицы срезов (миграция 202610050003)" });

  const latestClosed = closedMoscowDates(1)[0];
  const subjects = Number.isFinite(only) && only > 0 ? WB_SUBJECTS.filter((s) => s.id === only) : WB_SUBJECTS;
  // Очередь сдвигается с каждым окном крона: предмет, что стабильно не снимается, не стоит в голове каждого запуска.
  const tasks = planSnapshots(existing, latestClosed, subjects, Math.floor(startedAt.getTime() / ROTATION_STEP_MS));
  if (dryRun) return NextResponse.json({ ok: true, dryRun: true, latestClosed, tasks: tasks.map((t) => ({ subject: t.subject.name, id: t.subject.id, kind: t.kind, windowTo: t.windowTo })) });
  if (tasks.length === 0) {
    await writeSyncLog(JOB, "ok", 0, null, startedAt);
    return NextResponse.json({ ok: true, planned: 0 });
  }

  const quota = await mpstatsWbQuota();
  if (quota && quota.available - quota.used < QUOTA_RESERVE) {
    return fail(`квота WB-запросов MPSTATS на исходе (${quota.used} из ${quota.available}), срезы не снимаем`, 503);
  }

  const result = await collectWbQuerySnapshots(db, tasks, { fetchKeywords: subjectKeywordsFull, startBudgetMs: START_BUDGET_MS });
  const note = [
    quota ? null : "квота MPSTATS не определилась — защита от исчерпания не сработала",
    result.failed.length ? `не снялось: ${result.failed.map((f) => `${f.subject}${f.kind === "baseline" ? " (прошлый срез)" : ""} — ${f.error}`).join("; ")}` : null,
    result.stoppedBy === "rate_limit" ? "MPSTATS: исчерпан лимит запросов" : result.stoppedBy === "auth" ? "MPSTATS: токен недействителен" : null,
  ].filter(Boolean).join(". ");
  // Свежий срез не снялся или MPSTATS отказал — «error». Не снялся только «прошлый» срез (для роста) — «partial»: он нужен
  // не каждому экрану и повторяется следующими запусками. «partial» и у границы времени: остальное снимет следующий запуск.
  const currentFailed = result.failed.some((f) => f.kind === "current");
  const status = currentFailed || result.stoppedBy === "rate_limit" || result.stoppedBy === "auth" ? "error" : result.failed.length || result.stoppedBy === "budget" ? "partial" : "ok";
  await writeSyncLog(JOB, status, result.done.length, note || null, startedAt);
  return NextResponse.json({ ok: status !== "error", ...result, quota }, { status: status === "error" ? 502 : 200 });
}
