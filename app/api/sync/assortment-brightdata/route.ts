import { NextRequest, NextResponse } from "next/server";
import { hasBrightData } from "@/lib/assortment/brightdata";
import { collectBrightData, triggerBrightData } from "@/lib/assortment/brightdataCrawl";
import { isMissingAssortmentSchema } from "@/lib/assortment/errors";
import { checkCronAuth, writeSyncLog } from "@/lib/sync/helpers";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BUDGET_MS = 240_000;

/**
 * Сбор новинок ASOS и H&M через Bright Data — среда и суббота (решение
 * владельца 02.10.2026: каждый день платно и без пользы). Сбор асинхронный:
 * `?phase=trigger` в 08:00 МСК запускает пробы, `?phase=collect` в 09:30 и
 * 11:30 МСК забирает готовые. Первый сбор — база, в ленту не пишет.
 */
export async function GET(request: NextRequest) {
  const authError = await checkCronAuth(request);
  if (authError) return authError;
  const startedAt = new Date();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 503 });
  if (!hasBrightData()) return NextResponse.json({ ok: true, skipped: "ключ Bright Data не задан" });
  const phase = request.nextUrl.searchParams.get("phase") === "collect" ? "collect" : "trigger";
  const job = `assortment-brightdata-${phase}`;
  try {
    const results = phase === "trigger" ? await triggerBrightData(db) : await collectBrightData(db, startedAt.getTime() + BUDGET_MS);
    const failed = results.filter((r) => !r.ok);
    const added = results.reduce((s, r) => s + (r.added ?? 0), 0);
    const status = failed.length === 0 ? "ok" : failed.length < results.length ? "partial" : "error";
    await writeSyncLog(job, status, phase === "collect" ? added : results.reduce((s, r) => s + (r.triggered ?? 0), 0), failed.length ? failed.map((r) => `${r.sourceId}: ${r.error}`).join("; ") : null, startedAt);
    return NextResponse.json({ ok: status !== "error", phase, results });
  } catch (error) {
    if (isMissingAssortmentSchema(error)) return NextResponse.json({ ok: true, skipped: "таблицы модуля не созданы" });
    const message = error instanceof Error ? error.message : "сбор не удался";
    await writeSyncLog(job, "error", null, message, startedAt);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
