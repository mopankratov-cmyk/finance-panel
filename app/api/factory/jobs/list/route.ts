import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(_req: NextRequest) {
  return NextResponse.json({
    ok: true,
    disabled: true,
    note: "jobs/list отключён: старая очередь выведена из MVP, живые прогоны смотри в Пульсе завода",
    summary: { queued: 0, running: 0, polling: 0, done: 0, failed: 0 },
    jobs: [],
  }, { headers: { "Cache-Control": "no-store" } });
}
