import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(_req: NextRequest) {
  return NextResponse.json(
    { ok: true, disabled: true, note: "batch-build/tick отключён для стабильного MVP: tick не должен запускать второй оркестратор" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
