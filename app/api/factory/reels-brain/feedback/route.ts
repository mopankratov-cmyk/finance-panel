import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { internalFetch } from "@/lib/internalFetch";
import { buildReelsBrainFeedbackLoop, type ReelsBrainMetricRow } from "@/lib/factory/reelsBrainOperatingSystem";
import { loadReelsBrainFeedbackRows } from "@/lib/factory/reelsBrainFeedbackRows";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

async function loadRows(): Promise<{ rows: ReelsBrainMetricRow[]; warning: string | null }> {
  const db = getSupabaseAdmin();
  if (!db) return { rows: [], warning: "Supabase не настроен" };
  return loadReelsBrainFeedbackRows(db as any, 300) as Promise<{ rows: ReelsBrainMetricRow[]; warning: string | null }>;
}

export async function GET() {
  const { rows, warning } = await loadRows();
  return NextResponse.json({
    ok: true,
    feedback_loop: buildReelsBrainFeedbackLoop(rows),
    rows: rows.slice(0, 50),
    warning,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (!Number(body.recipe_id)) {
      return NextResponse.json({ ok: false, error: "нужен recipe_id опубликованного ролика" }, { status: 400 });
    }
    if (!Number(body.views)) {
      return NextResponse.json({ ok: false, error: "нужны views, чтобы Reels Brain понял outcome" }, { status: 400 });
    }
    const response = await internalFetch(`${req.nextUrl.origin}/api/factory/post-metrics`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...body,
        source: body.source || "reels_brain_feedback",
      }),
      signal: AbortSignal.timeout(25000),
    });
    const result = await response.json().catch(() => ({}));
    const { rows, warning } = await loadRows();
    return NextResponse.json({
      ok: response.ok && (result as { ok?: boolean }).ok !== false,
      post_metrics: result,
      feedback_loop: buildReelsBrainFeedbackLoop(rows),
      warning,
    }, { status: response.ok ? 200 : 500, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: "reels-brain feedback crash: " + String((error as Error)?.message || error).slice(0, 160) }, { status: 500 });
  }
}
