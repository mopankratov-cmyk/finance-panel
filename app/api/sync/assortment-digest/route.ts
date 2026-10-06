import { NextRequest, NextResponse } from "next/server";
import { digestMessages } from "@/lib/assortment/digest";
import { loadDigestFacts } from "@/lib/assortment/digestFacts";
import { isMissingAssortmentSchema } from "@/lib/assortment/errors";
import { sendTelegramMessage } from "@/lib/opiu/telegramBot";
import { checkCronAuth, writeSyncLog } from "@/lib/sync/helpers";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const JOB = "assortment-digest";
const DEFAULT_PANEL_URL = "https://finance-panel-two.vercel.app";

/**
 * Недельная сводка «Разработки ассортимента» в Telegram — воскресенье, 10:00
 * МСК (крон `0 7 * * 0`, решение владельца 01.10.2026). Канал — финансовый бот
 * (`FINANCE_TELEGRAM_*`), новых секретов нет. Окно — последние семь суток.
 *
 * Второй раз за сутки не шлёт: смотрит в sync_log успешный прогон этого
 * задания (повтор крона Vercel не задвоит сводку). `?dryRun=1` — только
 * собрать текст; `?force=1` — отправить ещё раз вручную.
 */
export async function GET(request: NextRequest) {
  const authError = await checkCronAuth(request);
  if (authError) return authError;
  const startedAt = new Date();
  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";
  const force = request.nextUrl.searchParams.get("force") === "1";
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 503 });

  const fail = async (error: string) => {
    if (!dryRun) await writeSyncLog(JOB, "error", null, error, startedAt);
    return NextResponse.json({ ok: false, error }, { status: 502 });
  };

  if (!dryRun && !force) {
    const since = new Date(startedAt.getTime() - 20 * 3600 * 1000).toISOString();
    const { data: done } = await db.from("sync_log").select("id").eq("job", JOB).eq("status", "ok").gte("started_at", since).limit(1);
    if (done && done.length > 0) return NextResponse.json({ ok: true, skipped: "уже отправлена сегодня" });
  }

  let texts: string[];
  try {
    const from = new Date(startedAt.getTime() - 7 * 24 * 3600 * 1000);
    const facts = await loadDigestFacts(db, from, startedAt, process.env.FINANCE_PANEL_URL || DEFAULT_PANEL_URL);
    // Не влезает в предел Telegram (4 096 символов; первое воскресенье месяца с месячной выжимкой) — уходит несколькими сообщениями,
    // а не отказом 400 на всю сводку.
    texts = digestMessages(facts);
  } catch (error) {
    if (isMissingAssortmentSchema(error)) return NextResponse.json({ ok: true, skipped: "таблицы модуля не созданы" });
    return fail(error instanceof Error ? error.message : "Факты недели не собрались");
  }
  if (dryRun) return NextResponse.json({ ok: true, dryRun: true, text: texts.join("\n\n"), parts: texts.length });

  try {
    for (const text of texts) await sendTelegramMessage(text);
  } catch (error) {
    return fail(`Telegram: ${error instanceof Error ? error.message : "не ответил"}`);
  }
  await writeSyncLog(JOB, "ok", 1, null, startedAt);
  return NextResponse.json({ ok: true, sent: true });
}
