import { NextResponse } from "next/server";

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  SYNC_WATCHDOG_SLA_MINUTES,
  syncWatchdogHealth,
  type SyncWatchdogLogRow,
} from "@/lib/sync/watchdogHealth";

export const dynamic = "force-dynamic";

function authorized(request: Request) {
  const supplied = request.headers.get("authorization");
  const secrets = [process.env.SYNC_WATCHDOG_SECRET, process.env.CRON_SECRET]
    .filter((secret): secret is string => Boolean(secret));
  return secrets.some((secret) => supplied === `Bearer ${secret}`);
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ ok: false, error: "Нет доступа" }, { status: 401 });

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 500 });

  const result = await db
    .from("sync_log")
    .select("job, status, error, started_at, finished_at")
    .in("job", Object.keys(SYNC_WATCHDOG_SLA_MINUTES))
    .order("finished_at", { ascending: false })
    .limit(500);

  if (result.error) {
    return NextResponse.json(
      { ok: false, error: `Не удалось прочитать журнал синхронизаций: ${result.error.message}` },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }

  const health = syncWatchdogHealth((result.data ?? []) as SyncWatchdogLogRow[]);
  return NextResponse.json(
    { generatedAt: new Date().toISOString(), ...health },
    { status: health.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
