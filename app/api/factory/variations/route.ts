import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(_req: NextRequest) {
  return NextResponse.json(
    { ok: true, disabled: true, note: "variations отключён для стабильного MVP: не добавляем лишний fan-out до стабильного single-run" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
