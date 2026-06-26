import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Historical compatibility stub.
// Sprint 1: explicit watchdog path выключен, чтобы не держать duplicate wake source рядом с cron fallback.
export async function GET(req: NextRequest) {
  return NextResponse.json({ ok: true, disabled: true, note: "watchdog отключён для стабильного MVP: резервный wake-up живёт в cron/tick, без второго watchdog-оркестратора" }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  try {
    return GET(req);
  } catch (e) {
    return NextResponse.json({
      ok: true,
      disabled: true,
      note: "watchdog отключён для стабильного MVP: резервный wake-up живёт в cron/tick, без второго watchdog-оркестратора",
      warning: "watchdog POST упал: " + String((e as Error)?.message || e).slice(0, 160),
    }, { headers: { "Cache-Control": "no-store" } });
  }
}
