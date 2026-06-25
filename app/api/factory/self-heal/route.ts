import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Historical compatibility stub.
// Sprint 1: self-heal выключен, чтобы ручной repair path не конкурировал с основным execution loop.
export async function POST(req: NextRequest) {
  try {
    return NextResponse.json({ ok: true, disabled: true, note: "self-heal disabled for Sprint 1 stability" }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: "self-heal crash: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}
