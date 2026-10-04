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
 * сборщик «работает», но ничего не приносит.
 *
 * Канал и учёт — как у сторожа «Полок»: финансовый Telegram-бот и
 * `finance_alerts`; новых секретов и таблиц нет. Сначала уходит сообщение, потом
 * ставится отметка: упал Telegram — следующий прогон повторит, а не промолчит.
 *
 * `?dryRun=1` — только посчитать, ничего не отправлять и не отмечать.
 */
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

  let freshness: AssortmentFreshness;
  try {
    const run = (columns: string) => db.from("assortment_sources").select(columns);
    const { data, error } = await run("source_id,name,last_attempt_at,last_success_at,last_error");
    // Колонки пульса — из миграции 202610020002; без неё судить не по чему.
    if (error && isMissingColumnError(error)) return NextResponse.json({ ok: true, skipped: "нет колонок пульса (миграция 202610020002)" });
    if (error) throw new Error(error.message);
    const facts: SourceFact[] = ((data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => ({
      sourceId: String(row.source_id),
      name: String(row.name ?? row.source_id),
      lastAttemptAt: typeof row.last_attempt_at === "string" ? row.last_attempt_at : null,
      lastSuccessAt: typeof row.last_success_at === "string" ? row.last_success_at : null,
      lastError: typeof row.last_error === "string" ? row.last_error : null,
    }));
    freshness = assortmentFreshness(facts, startedAt.getTime());
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Свежесть сборщиков не прочиталась");
  }

  const openResult = await db.from("finance_alerts").select("alert_key").like("alert_key", `${ASSORTMENT_ALERT_PREFIX}%`).eq("status", "open");
  if (openResult.error) return fail(`Не прочитались открытые тревоги: ${openResult.error.message}`);
  const plan = assortmentAlertPlan(freshness, (openResult.data ?? []).map((row) => String(row.alert_key)));
  if (dryRun) return NextResponse.json({ ok: true, dryRun: true, freshness, plan });

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
  return NextResponse.json({ ok: true, freshness, sent: plan.send });
}
