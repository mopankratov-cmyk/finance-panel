import { NextRequest, NextResponse } from "next/server";

import { sendTelegramMessage } from "@/lib/opiu/telegramBot";
import { SHELF_STALL_ACTION, shelfFreshness, shelfStallSummary, type ShelfFreshness } from "@/lib/shelf/freshness";
import {
  SHELF_ALERT_PREFIX,
  shelfAlertPlan,
  shelfRecoveredTelegram,
  shelfStallMessage,
  shelfStallTelegram,
} from "@/lib/shelf/freshnessAlert";
import { loadShelfFreshnessFacts } from "@/lib/shelf/freshnessFacts";
import { checkCronAuth, writeSyncLog } from "@/lib/sync/helpers";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const JOB = "shelf-freshness";

/**
 * Сторож сборщика «Полок» (Mac mini). Сборщик об отказах пишет только в свой
 * лог, и 21.09–01.10.2026 он девять дней не доставлял снимки, пока это не
 * заметили руками. Крон — через 2 ч 15 мин после каждого слота (12:15, 20:15,
 * 00:15 МСК): к этому времени слот либо пришёл, либо пропущен.
 *
 * Канал — уже существующий финансовый Telegram-бот (`FINANCE_TELEGRAM_*`), учёт
 * отправленного — `finance_alerts`, как у сигналов `/api/opiu/monitor`. Новых
 * секретов и таблиц нет. Сначала уходит сообщение, потом ставится отметка:
 * упал Telegram — следующий прогон повторит, а не промолчит. Что слать —
 * решает `shelfAlertPlan` (lib/shelf/freshnessAlert.ts).
 *
 * `?dryRun=1` — только посчитать, ничего не отправлять и не отмечать.
 */
export async function GET(request: NextRequest) {
  const authError = await checkCronAuth(request);
  if (authError) return authError;
  const startedAt = new Date();
  const nowMs = startedAt.getTime();
  const nowIso = startedAt.toISOString();
  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 503 });

  const fail = async (error: string) => {
    if (!dryRun) await writeSyncLog(JOB, "error", null, error, startedAt);
    return NextResponse.json({ ok: false, error }, { status: 502 });
  };

  let freshness: ShelfFreshness;
  try {
    freshness = shelfFreshness(await loadShelfFreshnessFacts(db, null), nowMs);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Свежесть «Полок» не прочиталась");
  }

  const openResult = await db.from("finance_alerts").select("alert_key").like("alert_key", `${SHELF_ALERT_PREFIX}%`).eq("status", "open");
  if (openResult.error) return fail(`Не прочитались открытые тревоги: ${openResult.error.message}`);
  const plan = shelfAlertPlan(freshness, (openResult.data ?? []).map((row) => String(row.alert_key)));
  if (dryRun) return NextResponse.json({ ok: true, dryRun: true, freshness, plan });

  try {
    if (plan.send === "stalled") await sendTelegramMessage(shelfStallTelegram(freshness, nowMs));
    if (plan.send === "recovered") await sendTelegramMessage(shelfRecoveredTelegram(freshness, plan.stalledAfter, nowMs));
  } catch (error) {
    return fail(`Telegram: ${error instanceof Error ? error.message : "не ответил"}`);
  }

  if (plan.openKey) {
    const upserted = await db.from("finance_alerts").upsert({
      alert_key: plan.openKey,
      severity: "critical",
      title: "Сбор «Полок» встал",
      message: shelfStallMessage(freshness, nowMs),
      action: SHELF_STALL_ACTION,
      status: "open",
      last_seen_at: nowIso,
    }, { onConflict: "alert_key" });
    if (upserted.error) return fail(`Тревога не записалась: ${upserted.error.message}`);
  }
  if (plan.resolveKeys.length) {
    const resolved = await db.from("finance_alerts").update({ status: "resolved", last_seen_at: nowIso }).in("alert_key", plan.resolveKeys);
    if (resolved.error) return fail(`Тревога не закрылась: ${resolved.error.message}`);
  }

  // Застой — ещё и красная строка в журнале синхронизаций.
  const stalled = freshness.state === "stalled";
  await writeSyncLog(JOB, stalled ? "error" : "ok", freshness.missedSlots, stalled ? `Сбор «Полок» встал: ${shelfStallSummary(freshness, nowMs)}` : null, startedAt);
  return NextResponse.json({ ok: true, freshness, sent: plan.send });
}
