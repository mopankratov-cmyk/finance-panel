import { NextRequest, NextResponse } from "next/server";

import { checkCronAuth, writeSyncLog } from "@/lib/sync/helpers";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const maxDuration = 60;

const RETENTION_DAYS = 90;

export async function GET(request: NextRequest) {
  const authError = await checkCronAuth(request);
  if (authError) return authError;

  const startedAt = new Date();
  const cutoff = new Date(startedAt.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1_000).toISOString();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });

  try {
    const { count, error } = await db
      .from("wb_stocks_history")
      .delete({ count: "exact" })
      .lt("snapshot_at", cutoff);

    if (error) throw new Error(`Очистка wb_stocks_history: ${error.message}`);

    const deleted = count ?? 0;
    await writeSyncLog("stocks-history-cleanup", "ok", deleted, null, startedAt);
    return NextResponse.json({ ok: true, deleted, cutoff });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Неизвестная ошибка";
    await writeSyncLog("stocks-history-cleanup", "error", null, message, startedAt);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
