import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

export async function POST(_req: NextRequest) {
  return NextResponse.json(
    { ok: true, disabled: true, note: "recipe-variants disabled for Sprint 1 stability" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
