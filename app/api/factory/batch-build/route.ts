import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(_req: NextRequest) {
  return NextResponse.json(
    { ok: true, disabled: true, note: "batch-build отключён для стабильного MVP: запускай готовый рецепт через graph-run" },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(_req: NextRequest) {
  return NextResponse.json(
    { ok: true, disabled: true, note: "batch-build отключён для стабильного MVP: запускай готовый рецепт через graph-run" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
