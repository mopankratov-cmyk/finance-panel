import { NextRequest, NextResponse } from "next/server";

import {
  assortmentAlertPlan,
  assortmentFreshness,
  assortmentRecoveredTelegram,
  assortmentStallMessage,
  assortmentStallTelegram,
  ASSORTMENT_ALERT_PREFIX,
  ASSORTMENT_STALL_ACTION,
  type AssortmentFreshness,
  type SourceFact,
} from "@/lib/assortment/freshness";
import { isMissingColumnError } from "@/lib/assortment/errors";
import { loadClipPulse } from "@/lib/assortment/freshnessStore";
import {
  brightdataBillingAlarm, jobsAlertPlan, jobsFreshness, jobsRecoveredTelegram, jobsStallMessage, jobsStallTelegram, JOBS_ALERT_PREFIX, JOBS_STALL_ACTION, WATCHED_JOB_NAMES,
  type JobRun, type JobsFreshness,
} from "@/lib/assortment/jobsWatch";
import { sendTelegramMessage } from "@/lib/opiu/telegramBot";
import { checkCronAuth, writeSyncLog } from "@/lib/sync/helpers";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const JOB = "assortment-freshness";

/**
 * Сторож сборщиков ассортимента. Сборщики (Shopify, Bright Data, сайты РФ через
 * Mac mini, Zalando, «Рынок РФ») об отказах пишут только в last_error источника —
 * экран краснеет не сразу, а в Telegram это приходит раз в неделю в воскресной
 * сводке. Здесь — молчание дольше порога по расписанию источника
 * (lib/assortment/collectorSchedule.ts), в том числе тихая поломка, когда
 * сборщик «работает», но ничего не приносит. Отпечатки фото (CLIP на Mac mini)
 * судятся по времени последнего отпечатка при ждущей очереди; всё, что приносит
 * mini, — одна тревога за один простой, а не сообщение на каждый источник.
 *
 * Канал и учёт — как у сторожа «Полок»: финансовый Telegram-бот и
 * `finance_alerts`; новых секретов и таблиц нет. Сначала уходит сообщение, потом
 * ставится отметка: упал Telegram — следующий прогон повторит, а не промолчит.
 *
 * `?dryRun=1` — только посчитать, ничего не отправлять и не отмечать.
 */
/**
 * Второй сторож — служебные задачи движка (недельные срезы спроса WB, признаки по
 * фото, рилсы, покупка и сбор Bright Data): они пишут в свои таблицы, а об отказах —
 * только в sync_log. Свои тревоги и свой ключ; сбой этого сторожа основной (по
 * источникам) не ломает. Журнал читается до сторожа источников: источники, молчащие
 * из-за денег Bright Data, уже названы тревогой задач — второе сообщение о той же
 * остановке не нужно.
 */
async function readJobs(db: NonNullable<ReturnType<typeof getSupabaseAdmin>>, now: Date): Promise<{ freshness: JobsFreshness } | { error: string }> {
  try {
    const since = new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString();
    const { data, error } = await db.from("sync_log").select("job,status,error,started_at,rows_affected").in("job", WATCHED_JOB_NAMES).gte("started_at", since).order("started_at", { ascending: false }).limit(1000);
    if (error) throw new Error(error.message);
    return { freshness: jobsFreshness((data ?? []) as JobRun[], now.getTime()) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "журнал задач не прочитался" };
  }
}

async function watchJobs(db: NonNullable<ReturnType<typeof getSupabaseAdmin>>, now: Date, dryRun: boolean, read: Awaited<ReturnType<typeof readJobs>>) {
  try {
    if ("error" in read) throw new Error(read.error);
    const { freshness } = read;
    const open = await db.from("finance_alerts").select("alert_key").like("alert_key", `${JOBS_ALERT_PREFIX}%`).eq("status", "open");
    if (open.error) throw new Error(open.error.message);
    const plan = jobsAlertPlan(freshness, (open.data ?? []).map((row) => String(row.alert_key)));
    if (dryRun) return { freshness, plan };
    if (plan.send === "stalled") await sendTelegramMessage(jobsStallTelegram(freshness));
    if (plan.send === "recovered") await sendTelegramMessage(jobsRecoveredTelegram());
    if (plan.openKey) {
      const upserted = await db.from("finance_alerts").upsert({
        alert_key: plan.openKey,
        severity: "warning",
        title: "Задачи движка тенденций остановились",
        message: jobsStallMessage(freshness),
        action: JOBS_STALL_ACTION,
        status: "open",
        last_seen_at: now.toISOString(),
      }, { onConflict: "alert_key" });
      if (upserted.error) throw new Error(upserted.error.message);
    }
    if (plan.resolveKeys.length) {
      const resolved = await db.from("finance_alerts").update({ status: "resolved", last_seen_at: now.toISOString() }).in("alert_key", plan.resolveKeys);
      if (resolved.error) throw new Error(resolved.error.message);
    }
    return { freshness, plan };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "сторож задач не отработал" };
  }
}

export async function GET(request: NextRequest) {
  const authError = await checkCronAuth(request);
  if (authError) return authError;
  const startedAt = new Date();
  const nowIso = startedAt.toISOString();
  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 503 });

  const fail = async (error: string) => {
    if (!dryRun) await writeSyncLog(JOB, "error", null, error, startedAt);
    return NextResponse.json({ ok: false, error }, { status: 502 });
  };

  const jobs = await readJobs(db, startedAt);
  // Сторож задач держит тревогу «нет денег» Bright Data — источники, молчащие по ней, второй тревогой не дублируем.
  const brightdataBillingAlarmed = "freshness" in jobs && brightdataBillingAlarm(jobs.freshness);
  let freshness: AssortmentFreshness;
  try {
    const run = (columns: string) => db.from("assortment_sources").select(columns);
    const { data, error } = await run("source_id,name,access_status,access_note,last_attempt_at,last_success_at,last_error");
    // Колонки пульса — из миграции 202610020002; без неё судить не по чему.
    if (error && isMissingColumnError(error)) return NextResponse.json({ ok: true, skipped: "нет колонок пульса (миграция 202610020002)" });
    if (error) throw new Error(error.message);
    const facts: SourceFact[] = ((data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => ({
      sourceId: String(row.source_id),
      name: String(row.name ?? row.source_id),
      lastAttemptAt: typeof row.last_attempt_at === "string" ? row.last_attempt_at : null,
      lastSuccessAt: typeof row.last_success_at === "string" ? row.last_success_at : null,
      lastError: typeof row.last_error === "string" ? row.last_error : null,
      accessStatus: typeof row.access_status === "string" ? row.access_status : null,
      accessNote: typeof row.access_note === "string" ? row.access_note : null,
    }));
    freshness = assortmentFreshness(facts, startedAt.getTime(), await loadClipPulse(db), { brightdataBillingAlarmed });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Свежесть сборщиков не прочиталась");
  }

  const openResult = await db.from("finance_alerts").select("alert_key").like("alert_key", `${ASSORTMENT_ALERT_PREFIX}%`).eq("status", "open");
  if (openResult.error) return fail(`Не прочитались открытые тревоги: ${openResult.error.message}`);
  const plan = assortmentAlertPlan(freshness, (openResult.data ?? []).map((row) => String(row.alert_key)));
  if (dryRun) return NextResponse.json({ ok: true, dryRun: true, freshness, plan, jobs: await watchJobs(db, startedAt, true, jobs) });

  try {
    if (plan.send === "stalled") await sendTelegramMessage(assortmentStallTelegram(freshness));
    if (plan.send === "recovered") await sendTelegramMessage(assortmentRecoveredTelegram());
  } catch (error) {
    return fail(`Telegram: ${error instanceof Error ? error.message : "не ответил"}`);
  }

  if (plan.openKey) {
    const upserted = await db.from("finance_alerts").upsert({
      alert_key: plan.openKey,
      severity: "warning",
      title: "Сборщики ассортимента молчат",
      message: assortmentStallMessage(freshness),
      action: ASSORTMENT_STALL_ACTION,
      status: "open",
      last_seen_at: nowIso,
    }, { onConflict: "alert_key" });
    if (upserted.error) return fail(`Тревога не записалась: ${upserted.error.message}`);
  }
  if (plan.resolveKeys.length) {
    const resolved = await db.from("finance_alerts").update({ status: "resolved", last_seen_at: nowIso }).in("alert_key", plan.resolveKeys);
    if (resolved.error) return fail(`Тревога не закрылась: ${resolved.error.message}`);
  }

  // Молчание — ещё и красная строка в журнале синхронизаций.
  const stalled = freshness.state === "stalled";
  await writeSyncLog(JOB, stalled ? "error" : "ok", freshness.stalled.length, stalled ? assortmentStallMessage(freshness) : null, startedAt);
  const jobsResult = await watchJobs(db, startedAt, false, jobs);
  return NextResponse.json({ ok: true, freshness, sent: plan.send, jobs: jobsResult });
}
