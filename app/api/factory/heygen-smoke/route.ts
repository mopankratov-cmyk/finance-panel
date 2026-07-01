import { NextRequest, NextResponse } from "next/server";
import { buildHeyGenSmokeVideoPlan } from "@/lib/factory/heygenVideo";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const plan = buildHeyGenSmokeVideoPlan(body);
    return NextResponse.json({
      ok: plan.ok,
      mode: "manual-smoke-plan-only",
      plan,
      note: "This route only builds the HeyGen dry-run body. Paid render must go through an explicit budget-guarded action.",
    }, { status: plan.ok ? 200 : 422, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: "heygen-smoke crash: " + String((e as Error)?.message || e).slice(0, 180),
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

