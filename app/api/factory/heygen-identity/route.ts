import { NextRequest, NextResponse } from "next/server";
import { buildHeyGenIdentityPlan } from "@/lib/factory/heygenIdentity";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  return NextResponse.json({
    ok: true,
    mode: "identity-plan-only",
    sources: ["existing_look", "prompt_design_ai", "upload_own_face", "mixed"],
    note: "No HeyGen write, upload, training, DB persist, or paid render happens in this route.",
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const plan = buildHeyGenIdentityPlan(body);
    return NextResponse.json({
      ok: plan.ok,
      mode: "identity-plan-only",
      plan,
    }, { status: plan.ok ? 200 : 422, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: "heygen-identity crash: " + String((e as Error)?.message || e).slice(0, 180),
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

