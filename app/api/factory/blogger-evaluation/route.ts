import { NextRequest, NextResponse } from "next/server";
import { BLOGGER_EVALUATION_RUBRIC, evaluateBloggerSample } from "@/lib/factory/bloggerEvaluation";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  return NextResponse.json({
    ok: true,
    mode: "detached-blogger-evaluation-dry-run",
    scorecard_version: "living_blogger_v1",
    rubric: BLOGGER_EVALUATION_RUBRIC,
    note: "Dry-run only. This endpoint scores blogger samples but does not persist them yet.",
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const evaluation = evaluateBloggerSample(body);
    return NextResponse.json({
      ok: evaluation.ok,
      mode: "detached-blogger-evaluation-dry-run",
      evaluation,
    }, { status: evaluation.ok ? 200 : 422, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: "blogger-evaluation crash: " + String((e as Error)?.message || e).slice(0, 180),
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
