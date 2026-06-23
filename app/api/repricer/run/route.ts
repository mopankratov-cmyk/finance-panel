import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { loadStrategies, runRepricer, persistDecisions } from "@/lib/repricer/run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/repricer/run?cabinet= — прогнать репрайсер и записать решения за сегодня.
export async function POST(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;

  const cabinet = new URL(request.url).searchParams.get("cabinet");
  const strategies = await loadStrategies();
  if (!strategies.length) {
    return NextResponse.json({ error: "Нет стратегий — применена ли миграция 20260626_repricer.sql?" }, { status: 400 });
  }
  const rows = await runRepricer(cabinet, strategies);
  const runDate = new Date().toISOString().slice(0, 10);
  const proposed = await persistDecisions(runDate, cabinet, rows);
  return NextResponse.json({ runDate, cabinet, total: rows.length, proposed, skipped: rows.length - proposed });
}
