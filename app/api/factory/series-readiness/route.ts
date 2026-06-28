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
    const blockers: string[] = [];
    if (snapshot.series_state.target_met) blockers.push("50-run цель уже закрыта");
    if (!snapshot.next_batch_gate.ready) blockers.push(snapshot.next_batch_gate.reason || "learning gate не готов");
    const readyToLaunchNext = blockers.length === 0;
    return NextResponse.json({
      ok: true,
      niche,
      ready_to_launch_next: readyToLaunchNext,
      blockers,
      next_batch_request: readyToLaunchNext ? {
        count: batchSize,
        niche,
        require_full_batch: true,
        require_learning_gate: true,
        auto_preflight: true,
        series_after: snapshot.series_start_at,
      } : null,
      series_start_at: snapshot.series_start_at,
      series_state: snapshot.series_state,
      next_batch_gate: snapshot.next_batch_gate,
      batch_plan: snapshot.batch_plan,
      feedback_queue_count: snapshot.feedback_queue.length,
      latest_batch: snapshot.latest_batch,
      warnings: snapshot.warnings,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      ready_to_launch_next: false,
      blockers: ["series readiness unavailable"],
      error: "series-readiness crash: " + String((e as Error)?.message || e).slice(0, 180),
    }, { status: 500 });
  }
}
