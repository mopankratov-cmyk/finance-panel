import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Historical compatibility stub.
// Sprint 1: self-heal выключен, чтобы ручной repair path не конкурировал с основным execution loop.
export async function POST(req: NextRequest) {
  try {
    return NextResponse.json({ ok: true, disabled: true, note: "self-heal отключён для стабильного MVP: ручная самопочинка не должна конкурировать с graph-run" }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: "self-heal упал: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}
