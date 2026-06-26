import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  return NextResponse.json({ ok: true, disabled: true, note: "scenario-rewrite отключён для стабильного MVP: MP4 собирается без переписывания сценария" }, { headers: { "Cache-Control": "no-store" } });
}
