import { NextRequest, NextResponse } from "next/server";
import { upgradeShopImages } from "@/lib/assortment/mediaUpgrade";
import { checkCronAuth, writeSyncLog } from "@/lib/sync/helpers";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const JOB = "assortment-media-upgrade";

/**
 * Разовая перезаливка фото ASOS и H&M в высоком разрешении (запускается
 * руками под сессией руководителя или Bearer CRON_SECRET; расписания нет).
 * Повторный запуск безопасен: уже перезалитые фото пропускаются.
 */
export async function GET(request: NextRequest) {
  const authError = await checkCronAuth(request);
  if (authError) return authError;
  const startedAt = new Date();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 503 });
  try {
    const result = await upgradeShopImages(db, startedAt.getTime() + 240_000);
    await writeSyncLog(JOB, result.failed ? "partial" : "ok", result.upgraded, result.failed ? `не скачалось: ${result.failed}` : null, startedAt);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "перезаливка не удалась";
    await writeSyncLog(JOB, "error", null, message, startedAt);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
