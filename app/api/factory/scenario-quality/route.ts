import { NextRequest, NextResponse } from "next/server";
import { analyzeScenarioQuality } from "@/lib/factory/scenarioQuality";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const result = await analyzeScenarioQuality(body);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: "проверка сценария упала: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
