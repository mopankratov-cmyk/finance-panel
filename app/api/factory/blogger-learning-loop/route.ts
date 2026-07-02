import { NextRequest, NextResponse } from "next/server";
import { buildKatyaLearningLoop } from "@/lib/factory/bloggerLearningLoop";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  const plan = buildKatyaLearningLoop({
    blogger_id: "katya_russian_creator_v3b",
    target_runs: 100,
    generation_size: 5,
  });
  return NextResponse.json({
    ok: true,
    mode: "katya-blogger-learning-loop-dry-run",
    note: "Dry-run only. This endpoint plans Katya actor iterations and does not render paid videos.",
    plan,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const plan = buildKatyaLearningLoop(body);
    return NextResponse.json({
      ok: plan.ok,
      mode: "katya-blogger-learning-loop-dry-run",
      plan,
    }, { status: plan.ok ? 200 : 422, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: "blogger-learning-loop crash: " + String((e as Error)?.message || e).slice(0, 180),
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
