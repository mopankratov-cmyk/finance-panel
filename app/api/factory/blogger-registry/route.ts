import { NextRequest, NextResponse } from "next/server";
import { evaluateBloggerSample } from "@/lib/factory/bloggerEvaluation";
import { applyEvaluationToRegistry, listBloggerVariants, registrySummary } from "@/lib/factory/bloggerRegistry";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  const registry = listBloggerVariants();
  return NextResponse.json({
    ok: true,
    mode: "detached-blogger-registry-dry-run",
    registry,
    summary: registrySummary(registry),
    note: "Dry-run only. This registry is static until we wire persistent storage.",
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const evaluationInput = body.evaluation || body;
    const evaluation = evaluateBloggerSample(evaluationInput);
    const registry = applyEvaluationToRegistry(listBloggerVariants(), evaluation);
    return NextResponse.json({
      ok: evaluation.ok,
      mode: "detached-blogger-registry-dry-run",
      evaluation,
      registry,
      summary: registrySummary(registry),
    }, { status: evaluation.ok ? 200 : 422, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: "blogger-registry crash: " + String((e as Error)?.message || e).slice(0, 180),
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
