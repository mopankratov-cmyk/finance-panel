import { NextRequest, NextResponse } from "next/server";
import { internalFetch } from "@/lib/internalFetch";
import { buildReelsBrainValidationRunbook } from "@/lib/factory/reelsBrainValidationRunbook";
import { buildReelsBrainSourceMixAudit } from "@/lib/factory/reelsBrainSourceMixAudit";
import { buildReelsBrainBriefCoverageAudit } from "@/lib/factory/reelsBrainBriefCoverageAudit";
import { buildReelsBrainShipReadyQueue } from "@/lib/factory/reelsBrainShipReadyQueue";
import { buildReelsBrainBriefGapProgress } from "@/lib/factory/reelsBrainBriefGapProgress";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

function compactProgress(body: Record<string, any> | null | undefined) {
  const totals = body?.totals || {};
  const platforms = Array.isArray(body?.platforms) ? body.platforms : [];
  const throughput = body?.throughput_24h || {};
  const bottlenecks = [
    { key: "media", count: Number(totals.media_backlog || 0), label: "media bridge" },
    { key: "audio", count: Number(totals.audio_backlog || 0), label: "audio extraction" },
    { key: "transcript", count: Number(totals.transcript_backlog || 0), label: "transcript layer" },
    { key: "analyze", count: Number(totals.analyze_backlog || 0), label: "pattern analysis" },
  ].sort((a, b) => b.count - a.count);
  return {
    throughput_24h: {
      analyzed: Number(throughput.analyzed || 0),
      inserted: Number(throughput.inserted || 0),
    },
    totals: {
      total: Number(totals.total || 0),
      with_media_candidates: Number(totals.with_media_candidates || 0),
      with_direct_media: Number(totals.with_direct_media || 0),
      audio_extracted: Number(totals.audio_extracted || 0),
      transcript_ready: Number(totals.transcript_ready || 0),
      analyzed: Number(totals.analyzed || 0),
      media_backlog: Number(totals.media_backlog || 0),
      audio_backlog: Number(totals.audio_backlog || 0),
      transcript_backlog: Number(totals.transcript_backlog || 0),
      analyze_backlog: Number(totals.analyze_backlog || 0),
      eta_hours: totals.eta_hours || null,
    },
    primary_bottleneck: bottlenecks[0] || null,
    platforms: platforms.map((row) => ({
      platform: row.platform,
      status: row.status,
      total: Number(row.total || 0),
      with_direct_media: Number(row.with_direct_media || 0),
      audio_extracted: Number(row.audio_extracted || 0),
      transcript_ready: Number(row.transcript_ready || 0),
      analyzed: Number(row.analyzed || 0),
      media_backlog: Number(row.media_backlog || 0),
      audio_backlog: Number(row.audio_backlog || 0),
      transcript_backlog: Number(row.transcript_backlog || 0),
      analyze_backlog: Number(row.analyze_backlog || 0),
      automation_eta_hours: row.automation_eta_hours || null,
    })),
    segment_watchlist: Array.isArray(body?.segment_watchlist)
      ? body.segment_watchlist.slice(0, 8).map((row: any) => ({
        niche: row.niche,
        platform: row.platform,
        total: Number(row.total || 0),
        total_backlog: Number(row.total_backlog || 0),
        dominant_gap: row.dominant_gap || null,
        direct_rate: Number(row.direct_rate || 0),
        audio_rate: Number(row.audio_rate || 0),
        transcript_ready_rate: Number(row.transcript_ready_rate || 0),
        analyzed_rate: Number(row.analyzed_rate || 0),
        automation_eta_hours: row.automation_eta_hours || null,
      }))
      : [],
  };
}

export async function GET(req: NextRequest) {
  try {
    const niches = req.nextUrl.searchParams.get("niches") || "ru_toys,ru_clothing,ru_cosmetics";
    const limit = req.nextUrl.searchParams.get("limit") || "80";
    const economicsUrl = new URL("/api/factory/reels-brain/learning-economics", req.nextUrl.origin);
    economicsUrl.searchParams.set("niches", niches);
    economicsUrl.searchParams.set("limit", limit);
    const progressUrl = new URL("/api/factory/reels-brain/progress", req.nextUrl.origin);
    progressUrl.searchParams.set("niches", niches);
    const [response, progressResponse] = await Promise.all([
      internalFetch(economicsUrl),
      internalFetch(progressUrl),
    ]);
    const body = await response.json().catch(() => ({}));
    const progressBody = await progressResponse.json().catch(() => ({}));
    if (!response.ok) return NextResponse.json(body, { status: response.status });
    const validationRunbook = buildReelsBrainValidationRunbook({
      validationQueue: body.autopilot_actions?.validation_queue || null,
      measurementPlan: body.measurement_plan || null,
      limit: 4,
    });
    const sourceMixAudit = buildReelsBrainSourceMixAudit({
      segmentSolutions: body.segment_solutions || null,
      segmentGenerationPacks: body.segment_generation_packs || null,
      exactSegmentQueue: body.exact_segment_queue || null,
      feedbackLoop: body.feedback_loop || body.next_intelligence_layers?.feedback_loop || null,
    });
    const briefCoverageAudit = buildReelsBrainBriefCoverageAudit({
      segmentGenerationPacks: body.segment_generation_packs || null,
      segmentCreativeExports: body.segment_creative_exports || null,
      limit: 6,
    });
    const shipReadyQueue = buildReelsBrainShipReadyQueue({
      briefCoverageAudit,
      segmentGenerationPacks: body.segment_generation_packs || null,
      limit: 6,
    });
    const briefGapProgress = buildReelsBrainBriefGapProgress({
      briefCoverageAudit,
      shipReadyQueue,
      limit: 6,
    });
    return NextResponse.json({
      ok: true,
      report_type: req.nextUrl.searchParams.get("type") || "daily",
      daily_report: body.daily_report || null,
      totals: body.totals || null,
      quality_gate: body.quality_gate || null,
      niche_comparison: body.niche_comparison || [],
      anti_pattern_brain: body.anti_pattern_brain || null,
      discovery_brain: body.discovery_brain || null,
      taxonomy_brain: body.taxonomy_brain || null,
      top_opportunities: body.top_opportunities || null,
      pattern_atlas: body.pattern_atlas || null,
      segment_playbook: body.segment_playbook || null,
      segment_output_banks: body.segment_output_banks || null,
      segment_decision_deck: body.segment_decision_deck || null,
      segment_priority_queue: body.segment_priority_queue || null,
      segment_generation_packs: body.segment_generation_packs || null,
      segment_creative_exports: body.segment_creative_exports || null,
      generation_readiness: body.generation_readiness || null,
      brief_coverage_audit: briefCoverageAudit,
      ship_ready_queue: shipReadyQueue,
      brief_gap_progress: briefGapProgress,
      source_mix_audit: sourceMixAudit,
      segment_readiness_audit: body.segment_readiness_audit || null,
      segment_stability_audit: body.segment_stability_audit || null,
      segment_solutions: body.segment_solutions || null,
      segment_solution_matrix: body.segment_solution_matrix || null,
      generation_policy: body.generation_policy || null,
      measurement_plan: body.measurement_plan || null,
      validation_runbook: validationRunbook,
      exact_segment_queue: body.exact_segment_queue || null,
      portfolio_readiness: body.portfolio_readiness || null,
      evidence_ledger: body.evidence_ledger || null,
      feedback_loop: body.feedback_loop || body.next_intelligence_layers?.feedback_loop || null,
      outcome_memory_brain: body.outcome_memory_brain || body.next_intelligence_layers?.outcome_memory || null,
      audio_visual_intelligence: body.audio_visual_intelligence || body.next_intelligence_layers?.audio_visual_intelligence || null,
      audio_visual_readiness: body.audio_visual_readiness || null,
      product_brain: body.product_brain || body.next_intelligence_layers?.product_brain || null,
      audience_brain: body.audience_brain || body.next_intelligence_layers?.audience_brain || null,
      experiment_brain: body.experiment_brain || body.next_intelligence_layers?.experiment_brain || null,
      portfolio_manager: body.portfolio_manager || body.next_intelligence_layers?.portfolio_manager || null,
      cost_governor: body.cost_governor || null,
      autopilot_actions: body.autopilot_actions || null,
      pipeline_progress: progressResponse.ok ? compactProgress(progressBody) : null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: "report reels-brain упал: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}
