import { NextRequest, NextResponse } from "next/server";
import { evaluateExperimentalProvider, EXPERIMENTAL_PROVIDER_FLAGS } from "@/lib/factory/providerEvaluation";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const decision = evaluateExperimentalProvider(body);
    return NextResponse.json({
      ok: true,
      mode: "provider_evaluation_shadow",
      decision,
      flags: EXPERIMENTAL_PROVIDER_FLAGS,
      note: decision.decision === "promote_candidate"
        ? "provider is still not primary; owner rollout required"
        : "provider remains disabled/candidate",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: "provider-evaluation crash: " + String((e as Error)?.message || e).slice(0, 160),
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
