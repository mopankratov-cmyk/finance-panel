import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { buildReelsBrainPlatformSummary } from "@/lib/factory/reelsBrainSummary";
import { buildNicheTrustSummary, buildOutcomeSignal, buildPatternTrustSummary } from "@/lib/factory/reelsBrainTrust";
import {
  assessTrainingReadiness,
  automationRunHistory,
  corpusQualityGate,
  incidentHistory,
  normalizeShortPlatform,
  preferredSourceProviders,
  queryLeaderboard,
  recoverableSourceQueries,
  recommendSourceQueries,
  suppressedSourceQueries,
  sourceProviderHistory,
  sourceRelearnPolicy,
} from "@/lib/factory/reelsBrainPlaybook";
import type { ReelsPlatform } from "@/lib/factory/reelsBrain";
import type { ReelsPatternMemory } from "@/lib/factory/reelsBrainPatterns";
import type { ReelsBrainMetricRow } from "@/lib/factory/reelsBrainOperatingSystem";
import type { ReelsBrainAudioCoverageInput } from "@/lib/factory/reelsBrainTrust";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

function patternCountsFromPlaybook(playbook: unknown): Partial<Record<ReelsPlatform, number>> {
  const pb = playbook && typeof playbook === "object" ? playbook as Record<string, unknown> : {};
  const root = pb.reels_brain_patterns && typeof pb.reels_brain_patterns === "object" ? pb.reels_brain_patterns as Record<string, unknown> : {};
  const brains = root.platform_brains && typeof root.platform_brains === "object" ? root.platform_brains as Record<string, unknown> : {};
  const out: Partial<Record<ReelsPlatform, number>> = {};
  for (const platform of ["tiktok", "instagram", "youtube"] as ReelsPlatform[]) {
    const brain = brains[platform] && typeof brains[platform] === "object" ? brains[platform] as Record<string, unknown> : {};
    out[platform] = Array.isArray(brain.patterns) ? brain.patterns.length : 0;
  }
  return out;
}

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asBrain(value: unknown): ReelsPatternMemory | null {
  const row = rec(value);
  return Array.isArray(row.patterns) ? row as unknown as ReelsPatternMemory : null;
}

function daysSince(value: string | undefined): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return null;
  return Math.max(0, Math.floor((Date.now() - time) / (24 * 60 * 60 * 1000)));
}

function readAudioSeed(value: unknown) {
  const analyzedFull = rec(value);
  const reelsSeed = rec(analyzedFull.reels_seed);
  const pipeline = rec(reelsSeed.pipeline);
  const transcript = typeof reelsSeed.transcript === "string" ? reelsSeed.transcript.trim() : "";
  const audioFeatures = rec(reelsSeed.audio_features);
  return {
    transcript,
    transcript_status: String(pipeline.transcript_status || "").trim(),
    audio_features: audioFeatures,
  };
}

function buildAudioCoverage(rows: Array<{ analyzed?: boolean | null; analyzed_full?: unknown }>): ReelsBrainAudioCoverageInput {
  let analyzedVideos = 0;
  let withAudio = 0;
  let withTranscript = 0;
  let pauseMapReady = 0;
  let pacingReady = 0;
  let beatHintReady = 0;

  for (const row of rows) {
    if (row.analyzed) analyzedVideos += 1;
    const seed = readAudioSeed(row.analyzed_full);
    const hasAudio = Object.keys(seed.audio_features).length > 0;
    const hasTranscript = seed.transcript.length > 20 || seed.transcript_status === "transcript_ready";
    if (hasAudio) {
      withAudio += 1;
      if (seed.audio_features.pause_count != null) pauseMapReady += 1;
      if (String(seed.audio_features.pacing_tier || "").trim()) pacingReady += 1;
      if (String(seed.audio_features.beat_density_hint || "").trim()) beatHintReady += 1;
    }
    if (hasTranscript) withTranscript += 1;
  }

  return {
    corpus_videos: rows.length,
    analyzed_videos: analyzedVideos,
    with_audio: withAudio,
    with_transcript: withTranscript,
    pause_map_ready: pauseMapReady,
    pacing_ready: pacingReady,
    beat_hint_ready: beatHintReady,
  };
}

// GET ?niche= — platform-aware brain lab summary: corpus, patterns, winners, providers.
export async function GET(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ ok: true, niche: null, platforms: [], warning: "Supabase не настроен" }, { headers: { "Cache-Control": "no-store" } });
    const niche = String(req.nextUrl.searchParams.get("niche") || "").trim();
    if (!niche) return NextResponse.json({ error: "нужна niche" }, { status: 400 });

    const [
      { data: videos, error: videosError },
      { data: winners, error: winnersError },
      { data: playbookRows, error: playbookError },
      { data: feedbackRows, error: feedbackError },
    ] = await Promise.all([
      db.from("viral_videos")
        .select("platform,virality_score,analyzed,analyzed_full,hook_text,format_detected,sound_title,source_orbit_id")
        .eq("niche", niche)
        .order("virality_score", { ascending: false, nullsFirst: false })
        .limit(1000),
      db.from("content_assets")
        .select("winner_learnings")
        .eq("niche", niche)
        .eq("is_winner", true)
        .order("winner_at", { ascending: false })
        .limit(100),
      db.from("niche_playbooks")
        .select("playbook")
        .eq("niche", niche)
        .order("updated_at", { ascending: false })
        .limit(1),
      db.from("post_metrics")
        .select("recipe_id,platform,views,watch_rate,hook_rate,hold_rate,completion_rate,ctr_card,saves,marketplace_orders,revenue,posted_at,pulled_at")
        .limit(300),
    ]);

    if (videosError) return NextResponse.json({ error: videosError.message }, { status: 500 });
    const metricRows = feedbackError ? [] : (((feedbackRows || []) as ReelsBrainMetricRow[]));
    const playbook = (playbookRows as { playbook?: unknown }[] | null)?.[0]?.playbook;
    const patternCounts = playbookError ? {} : patternCountsFromPlaybook(playbook);
    const playbookRoot = rec(playbook);
    const patternRoot = rec(playbookRoot.reels_brain_patterns);
    const platformBrains = rec(patternRoot.platform_brains);
    const rebuildContext = rec(patternRoot.rebuild_context);
    const metaBrain = asBrain(patternRoot.meta_brain) || asBrain(patternRoot);
    const videoRows = ((videos as Array<{ platform?: string | null; analyzed?: boolean | null; analyzed_full?: unknown }> | null) || []);
    const platforms = buildReelsBrainPlatformSummary({
      videos: (videos as Parameters<typeof buildReelsBrainPlatformSummary>[0]["videos"] | null) || [],
      winners: winnersError ? [] : ((winners as Parameters<typeof buildReelsBrainPlatformSummary>[0]["winners"] | null) || []),
      patternCounts,
    }).map((platform) => {
      const qualityGates = corpusQualityGate(playbook, platform.platform);
      const trainingReadiness = assessTrainingReadiness(playbook, platform.platform, {
        videos: platform.videos,
        analyzed: platform.analyzed,
        patterns: platform.pattern_count,
        winners: platform.winners,
      });
      const brain = asBrain(platformBrains[platform.platform]);
      const outcome = buildOutcomeSignal(metricRows, platform.platform);
      const audioCoverage = buildAudioCoverage(videoRows.filter((row) => normalizeShortPlatform(String(row.platform || "")) === platform.platform));
      return {
        ...platform,
        relearn_policy: sourceRelearnPolicy(playbook, platform.platform),
        quality_gates: qualityGates,
        recommended_queries: recommendSourceQueries(playbook, niche, platform.platform),
        training_readiness: trainingReadiness,
        outcome_signal: outcome,
        trust: buildPatternTrustSummary(brain, trainingReadiness, qualityGates, outcome, audioCoverage),
        provider_history: sourceProviderHistory(playbook, platform.platform).slice(0, 5),
        query_leaderboard: queryLeaderboard(playbook, platform.platform).slice(0, 5),
        suppressed_queries: suppressedSourceQueries(playbook, platform.platform).slice(0, 5),
        recovery_queries: recoverableSourceQueries(playbook, platform.platform).slice(0, 3),
      };
    });
    const platformsWithAlerts = platforms.map((platform) => {
      const preferred = preferredSourceProviders(playbook)[normalizeShortPlatform(platform.platform)];
      const staleDays = daysSince(preferred?.updated_at);
      const drifted = sourceProviderHistory(playbook, platform.platform).slice(0, 2)
        .map((row) => row.provider)
        .filter(Boolean);
      const championChangedRecently = drifted.length > 1 && drifted[0] !== drifted[1];
      const stale = staleDays != null && staleDays > platform.relearn_policy.stale_days;
      const alerts = [
        !platform.training_readiness.ready ? `brain not ready: ${platform.training_readiness.missing.join(", ")}` : "",
        stale ? `provider stale: ${staleDays}d` : "",
        championChangedRecently ? "provider drift detected" : "",
      ].filter(Boolean);
      return {
        ...platform,
        preferred_provider: preferred || null,
        provider_stale_days: staleDays,
        provider_drift: championChangedRecently,
        alerts,
        status: alerts.length ? (platform.training_readiness.ready ? "watch" : "weak") : platform.trust.status,
      };
    });
    const nicheTotals = {
      videos: platformsWithAlerts.reduce((sum, platform) => sum + platform.videos, 0),
      analyzed: platformsWithAlerts.reduce((sum, platform) => sum + platform.analyzed, 0),
      patterns: metaBrain?.patterns.length || 0,
      winners: platformsWithAlerts.reduce((sum, platform) => sum + platform.winners, 0),
    };
    const nicheGates = platformsWithAlerts.reduce((acc, platform) => ({
      min_videos: acc.min_videos + Number(platform.quality_gates?.min_videos || 0),
      min_analyzed: acc.min_analyzed + Number(platform.quality_gates?.min_analyzed || 0),
      min_patterns: acc.min_patterns + Number(platform.quality_gates?.min_patterns || 0),
      min_winners: acc.min_winners + Number(platform.quality_gates?.min_winners || 0),
    }), { min_videos: 0, min_analyzed: 0, min_patterns: 0, min_winners: 0 });
    const metaOutcome = buildOutcomeSignal(metricRows, "all");
    const metaAudioCoverage = buildAudioCoverage(videoRows);
    const metaReadiness = {
      platform: "tiktok" as const,
      ready:
        nicheTotals.videos >= nicheGates.min_videos
        && nicheTotals.analyzed >= nicheGates.min_analyzed
        && nicheTotals.patterns >= nicheGates.min_patterns
        && nicheTotals.winners >= nicheGates.min_winners,
      score: 0,
      videos: nicheTotals.videos,
      analyzed: nicheTotals.analyzed,
      patterns: nicheTotals.patterns,
      winners: nicheTotals.winners,
      gates: nicheGates,
      missing: [
        nicheTotals.videos >= nicheGates.min_videos ? "" : "videos",
        nicheTotals.analyzed >= nicheGates.min_analyzed ? "" : "analyzed",
        nicheTotals.patterns >= nicheGates.min_patterns ? "" : "patterns",
        nicheTotals.winners >= nicheGates.min_winners ? "" : "winners",
      ].filter(Boolean),
    };
    const trust_overview = buildNicheTrustSummary({
      niche,
      meta_brain: metaBrain,
      readiness: metaReadiness,
      gates: metaReadiness.gates,
      outcome: metaOutcome,
      audio: metaAudioCoverage,
      platforms: platformsWithAlerts.map((platform) => ({
        platform: platform.platform,
        trust: platform.trust,
      })),
    });
    const anti_pattern_hotspots = platformsWithAlerts
      .flatMap((platform) => (platform.trust.top_risks || []).map((label) => ({
        platform: platform.platform,
        label,
        severity: platform.trust.high_risk_anti_patterns > 0 ? "high" : platform.trust.medium_risk_anti_patterns > 0 ? "medium" : "low",
        trust_score: platform.trust.score,
      })))
      .slice(0, 9);

    return NextResponse.json({
      ok: true,
      niche,
      total_videos: platformsWithAlerts.reduce((sum, platform) => sum + platform.videos, 0),
      total_winners: platformsWithAlerts.reduce((sum, platform) => sum + platform.winners, 0),
      trust_overview,
      pattern_rebuild_context: Object.keys(rebuildContext).length ? rebuildContext : null,
      anti_pattern_hotspots,
      platforms: platformsWithAlerts,
      preferred_source_providers: preferredSourceProviders(playbook),
      source_provider_history: sourceProviderHistory(playbook).slice(0, 15),
      incidents: incidentHistory(playbook).slice(0, 20),
      automation_history: automationRunHistory(playbook).slice(0, 10),
      warnings: [winnersError?.message, playbookError?.message, feedbackError?.message].filter(Boolean),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: "summary reels-brain упал: " + String((e as Error)?.message || e).slice(0, 160) }, { status: 500 });
  }
}
