import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

export async function POST(_req: NextRequest) {
  return NextResponse.json(
    { ok: true, disabled: true, note: "recipe-variants отключён для стабильного MVP: варианты вернём после устойчивого single-run" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
