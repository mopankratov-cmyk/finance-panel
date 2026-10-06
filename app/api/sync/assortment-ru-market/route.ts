import { NextRequest, NextResponse } from "next/server";
import { isMissingAssortmentSchema } from "@/lib/assortment/errors";
import { collectRuMarket, learnFromRuMarket, ruMarketSyncSummary } from "@/lib/assortment/ruMarketStore";
import { checkCronAuth, writeSyncLog } from "@/lib/sync/helpers";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const JOB = "assortment-ru-market";

/**
 * «Рынок РФ» — понедельник 07:00 МСК (крон `0 4 * * 1`): топ продаж WB в
 * предметах своих товаров и Lime на WB по MPSTATS (без цен и выручки), затем
 * «учимся»: зарубежным находкам — самое продаваемое похожее по фото на WB.
 * `?phase=learn` — только второй шаг (после того как mini посчитал отпечатки).
 */
export async function GET(request: NextRequest) {
  const authError = await checkCronAuth(request);
  if (authError) return authError;
  const startedAt = new Date();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 503 });
  const learnOnly = request.nextUrl.searchParams.get("phase") === "learn";
  const deadline = startedAt.getTime() + 240_000;
  try {
    const collected = learnOnly ? [] : await collectRuMarket(db, deadline - 60_000);
    const learned = await learnFromRuMarket(db, deadline);
    const summary = ruMarketSyncSummary(collected, learned);
    await writeSyncLog(JOB, summary.status, summary.added, summary.message, startedAt);
    return NextResponse.json({ ok: true, collected, learned });
  } catch (error) {
    if (isMissingAssortmentSchema(error)) return NextResponse.json({ ok: true, skipped: "таблицы модуля не созданы" });
    const message = error instanceof Error ? error.message : "сбор не удался";
    await writeSyncLog(JOB, "error", null, message, startedAt);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
