import { NextRequest, NextResponse } from "next/server";
import { aiAttributesConfigured, AiAttributesUnavailableError, estimateAttributes, pendingForAi } from "@/lib/assortment/aiAttributesStore";
import { isMissingAssortmentSchema } from "@/lib/assortment/errors";
import { checkCronAuth, writeSyncLog } from "@/lib/sync/helpers";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const JOB = "assortment-ai-attributes";
const DAILY_LIMIT = Number(process.env.ASSORTMENT_AI_DAILY_LIMIT || 20);
const BUDGET_MS = 240_000;

/**
 * Ежедневно в 12:00 МСК (после автообхода и сбора Bright Data): признаки по
 * фото для новых моделей — не больше 20 в день (ASSORTMENT_AI_DAILY_LIMIT),
 * чтобы расход на ИИ был предсказуемым. Ответ ИИ — «оценка ИИ», ручное и
 * опубликованное не перезаписывает.
 */
export async function GET(request: NextRequest) {
  const authError = await checkCronAuth(request);
  if (authError) return authError;
  const startedAt = new Date();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 503 });
  if (!aiAttributesConfigured()) return NextResponse.json({ ok: true, skipped: "ключи ИИ не заданы" });
  try {
    const ids = await pendingForAi(db, DAILY_LIMIT);
    let done = 0;
    const errors: string[] = [];
    for (const id of ids) {
      if (Date.now() - startedAt.getTime() > BUDGET_MS) break;
      try {
        if (await estimateAttributes(db, id)) done += 1;
      } catch (error) {
        errors.push(error instanceof Error ? error.message.slice(0, 160) : "ошибка");
        if (error instanceof AiAttributesUnavailableError) break; // оба провайдера лежат — дальше без толку
      }
    }
    const status = errors.length === 0 ? "ok" : done > 0 ? "partial" : "error";
    await writeSyncLog(JOB, status, done, errors.length ? errors.slice(0, 3).join("; ") : null, startedAt);
    return NextResponse.json({ ok: status !== "error", queued: ids.length, done, errors: errors.slice(0, 3) });
  } catch (error) {
    if (isMissingAssortmentSchema(error)) return NextResponse.json({ ok: true, skipped: "таблицы модуля не созданы" });
    const message = error instanceof Error ? error.message : "разбор не удался";
    await writeSyncLog(JOB, "error", null, message, startedAt);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
