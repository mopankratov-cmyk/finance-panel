import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(_req: NextRequest) {
  return NextResponse.json(
    { ok: true, disabled: true, note: "jobs/enqueue отключён: старая очередь выведена из MVP, запускай рецепт через graph-run" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
