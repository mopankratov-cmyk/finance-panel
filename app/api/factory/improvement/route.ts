import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadImprovementSnapshot } from "@/lib/factory/improvementLoop";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

export async function GET(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 500 });
    const sp = req.nextUrl.searchParams;
    const niche = (sp.get("niche") || "").trim() || null;
    const targetRuns = Math.max(5, Math.min(200, Number(sp.get("target_runs")) || 50));
    const batchSize = Math.max(2, Math.min(10, Number(sp.get("batch_size")) || 5));
    const seriesAfter = (sp.get("series_after") || "").trim() || null;
    const snapshot = await loadImprovementSnapshot(db, { niche, target_runs: targetRuns, batch_size: batchSize, series_after: seriesAfter });
    return NextResponse.json({ ok: true, ...snapshot }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: "improvement route crash: " + String((e as Error)?.message || e).slice(0, 180),
      niche: null,
      target_runs: 50,
      batch_size: 5,
      series_start_at: null,
      total_runs: 0,
      analyzed_runs: [],
      feedback_queue: [],
      batches: [],
      top_patterns: [],
      axis_insights: [],
      latest_batch: null,
      previous_batch: null,
      series_state: { target_batches: 10, completed_batches: 0, current_batch_index: 1, next_batch_index: 1, remaining_runs: 50, remaining_batches: 10, current_batch_complete: false, target_met: false },
      progress: { runs_completed: 0, batches_completed: 0, target_runs_met: false, latest_batch_improved: null },
      next_batch_gate: { ready: false, reason: "improvement loop unavailable", current_feedback: 0, required_feedback: 0 },
      batch_plan: null,
      next_actions: [],
      warnings: ["improvement loop unavailable"],
    }, { status: 500 });
  }
}
