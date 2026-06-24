import { NextRequest, NextResponse } from "next/server";
import { analyzeScenarioQuality } from "@/lib/factory/scenarioQuality";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const result = await analyzeScenarioQuality(body);
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
