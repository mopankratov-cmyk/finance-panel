import {
  assessTrainingReadiness,
  automationRunHistory,
  corpusQualityGate,
  incidentHistory,
  normalizeShortPlatform,
  preferredSourceProviders,
  queryLeaderboard,
  recommendSourceQueries,
  sourceProviderHistory,
  sourceRelearnPolicy,
} from "./reelsBrainPlaybook";
import { buildReelsBrainPlatformSummary } from "./reelsBrainSummary";
import type { ReelsPlatform } from "./reelsBrain";
import {
  corpusProgress,
  corpusExecutionPlan,
  corpusStage,
  corpusTargetByNiche,
  corpusTargetByPlatform,
  REELS_BRAIN_CORPUS_TARGET_TOTAL,
} from "./reelsBrainCorpusTargets";

export const DEFAULT_REELS_BRAIN_NICHES = ["toys", "clothing", "cosmetics", "default"];

type ProviderShiftSignal = {
  active: boolean;
  from_provider: string | null;
  to_provider: string | null;
  source: string | null;
  updated_at: string | null;
  reason: string | null;
};

type RetrySignal = {
  recommended: boolean;
  action: "retry_shifted_provider" | "source_refresh" | "mini_bake_off" | "loop" | "monitor";
  reason: string | null;
};

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

function daysSince(value: string | undefined): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return null;
  return Math.max(0, Math.floor((Date.now() - time) / (24 * 60 * 60 * 1000)));
}

function providerShiftSignal(playbook: unknown, platform: ReelsPlatform): ProviderShiftSignal {
  const history = sourceProviderHistory(playbook, platform).slice(0, 2);
  const latest = history[0];
  const previous = history[1];
  const active = Boolean(latest?.provider && previous?.provider && latest.provider !== previous.provider);
  const source = latest?.source || null;
  const reason = active
    ? source === "bake-off"
      ? `${platform} shifted provider after bake-off`
      : `${platform} shifted provider after source relearn`
    : null;
  return {
    active,
    from_provider: active ? previous?.provider || null : null,
    to_provider: active ? latest?.provider || null : null,
    source,
    updated_at: latest?.updated_at || null,
    reason,
  };
}

function retrySignal(input: {
  platform: ReelsPlatform;
  status: string;
  readiness_score: number;
  preferred_provider_age_days: number | null;
  relearn_policy: { stale_days: number };
  provider_shift: ProviderShiftSignal;
  latest_incident_kind: string | null;
}): RetrySignal {
  if (input.provider_shift.active && input.provider_shift.to_provider) {
    return {
      recommended: true,
      action: "retry_shifted_provider",
      reason: `${input.platform} should retry on ${input.provider_shift.to_provider} after lane shift`,
    };
  }
  if (input.preferred_provider_age_days != null && input.preferred_provider_age_days > input.relearn_policy.stale_days) {
    return {
      recommended: true,
      action: "source_refresh",
      reason: `${input.platform} preferred provider is stale`,
    };
  }
  if (input.latest_incident_kind === "empty_intake" || input.latest_incident_kind === "low_yield") {
    return {
      recommended: true,
      action: "mini_bake_off",
      reason: `${input.platform} latest intake quality is weak`,
    };
  }
  if (input.status !== "ready" || input.readiness_score < 50) {
    return {
      recommended: true,
      action: "loop",
      reason: `${input.platform} readiness still needs more corpus`,
    };
  }
  return {
    recommended: false,
    action: "monitor",
    reason: `${input.platform} is stable enough`,
  };
}

function nextPlatformAction(platform: {
  platform: ReelsPlatform;
  status: string;
  readiness_score: number;
  preferred_provider: string | null;
  preferred_provider_age_days: number | null;
  provider_drift: boolean;
  provider_shift: ProviderShiftSignal;
  retry_signal: RetrySignal;
  top_query: string | null;
  relearn_policy: { stale_days: number };
}) {
  if (platform.retry_signal.recommended && platform.retry_signal.action === "retry_shifted_provider") {
    return {
      priority: "p1",
      action: "retry_shifted_provider",
      reason: platform.retry_signal.reason || `${platform.platform} shifted provider lane`,
      query: platform.top_query,
    };
  }
  if (platform.provider_drift) {
    return {
      priority: "p1",
      action: "mini_bake_off",
      reason: `${platform.platform} provider drift detected`,
      query: platform.top_query,
    };
  }
  if (platform.preferred_provider_age_days != null && platform.preferred_provider_age_days > platform.relearn_policy.stale_days) {
    return {
      priority: "p1",
      action: "source_refresh",
      reason: `${platform.platform} preferred provider is stale`,
      query: platform.top_query,
    };
  }
  if (platform.status !== "ready" || platform.readiness_score < 50) {
    return {
      priority: "p2",
      action: "loop",
      reason: `${platform.platform} readiness is weak`,
      query: platform.top_query,
    };
  }
  return {
    priority: "p3",
    action: "monitor",
    reason: `${platform.platform} is stable enough`,
    query: platform.top_query,
  };
}

function nextNicheAction(input: {
  niche: string;
  readiness_avg: number;
  critical_incidents: number;
  platforms: Array<{
    platform: ReelsPlatform;
    status: string;
    readiness_score: number;
    preferred_provider: string | null;
    preferred_provider_age_days: number | null;
    provider_drift: boolean;
    provider_shift: ProviderShiftSignal;
    retry_signal: RetrySignal;
    top_query: string | null;
    relearn_policy: { stale_days: number };
  }>;
}) {
  const ranked = input.platforms
    .map((platform) => ({ platform: platform.platform, ...nextPlatformAction(platform) }))
    .sort((a, b) =>
      a.priority.localeCompare(b.priority)
      || a.platform.localeCompare(b.platform),
    );
  const top = ranked[0];
  if (input.critical_incidents > 0) {
    return {
      priority: "p1",
      action: "inspect_incidents",
      reason: `${input.critical_incidents} critical incidents in ${input.niche}`,
      platform: top?.platform || null,
      query: top?.query || null,
    };
  }
  if (input.readiness_avg < 40) {
    return {
      priority: "p1",
      action: "weekly_retrain",
      reason: `${input.niche} average readiness is below 40%`,
      platform: top?.platform || null,
      query: top?.query || null,
    };
  }
  return {
    priority: top?.priority || "p3",
    action: top?.action || "monitor",
    reason: top?.reason || `${input.niche} is stable enough`,
    platform: top?.platform || null,
    query: top?.query || null,
  };
}

export function parseReelsBrainNiches(value: string | null): string[] {
  if (!value) return DEFAULT_REELS_BRAIN_NICHES;
  return Array.from(new Set(
    value.split(",").map((row) => row.trim()).filter(Boolean),
  )).slice(0, 10);
}

export async function loadReelsBrainPortfolioDigest(db: any, niches: string[] = DEFAULT_REELS_BRAIN_NICHES) {
  const nicheTargets = corpusTargetByNiche(niches, REELS_BRAIN_CORPUS_TARGET_TOTAL);
  const platformTargets = corpusTargetByPlatform(REELS_BRAIN_CORPUS_TARGET_TOTAL);
  const rows = await Promise.all(niches.map(async (niche) => {
    const [{ data: videos }, { data: winners }, { data: playbookRows }] = await Promise.all([
      db.from("viral_videos")
        .select("platform,virality_score,analyzed,hook_text,format_detected,sound_title,source_orbit_id")
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
    ]);
    const playbook = (playbookRows as { playbook?: unknown }[] | null)?.[0]?.playbook;
    const summary = buildReelsBrainPlatformSummary({
      videos: (videos as Parameters<typeof buildReelsBrainPlatformSummary>[0]["videos"] | null) || [],
      winners: (winners as Parameters<typeof buildReelsBrainPlatformSummary>[0]["winners"] | null) || [],
      patternCounts: patternCountsFromPlaybook(playbook),
    });

    const platforms = summary.map((platform) => {
      const readiness = assessTrainingReadiness(playbook, platform.platform, {
        videos: platform.videos,
        analyzed: platform.analyzed,
        patterns: platform.pattern_count,
        winners: platform.winners,
      });
      const preferred = preferredSourceProviders(playbook)[normalizeShortPlatform(platform.platform)];
      const history = sourceProviderHistory(playbook, platform.platform).slice(0, 2);
      const latestPlatformIncident = incidentHistory(playbook, platform.platform)[0];
      const shift = providerShiftSignal(playbook, platform.platform);
      const staleDays = daysSince(preferred?.updated_at);
      const retry = retrySignal({
        platform: platform.platform,
        status: readiness.ready ? "ready" : "weak",
        readiness_score: readiness.score,
        preferred_provider_age_days: staleDays,
        relearn_policy: sourceRelearnPolicy(playbook, platform.platform),
        provider_shift: shift,
        latest_incident_kind: latestPlatformIncident?.kind || null,
      });
      return {
        platform: platform.platform,
        status: readiness.ready ? "ready" : "weak",
        readiness_score: readiness.score,
        videos: platform.videos,
        analyzed: platform.analyzed,
        winners: platform.winners,
        pattern_count: platform.pattern_count,
        preferred_provider: preferred?.provider || null,
        preferred_provider_age_days: staleDays,
        provider_drift: history.length > 1 && history[0].provider !== history[1].provider,
        provider_shift: shift,
        retry_signal: retry,
        top_query: queryLeaderboard(playbook, platform.platform)[0]?.query || recommendSourceQueries(playbook, niche, platform.platform)[0] || null,
        relearn_policy: sourceRelearnPolicy(playbook, platform.platform),
        quality_gates: corpusQualityGate(playbook, platform.platform),
      };
    });

    const readinessAvg = platforms.length
      ? Math.round(platforms.reduce((sum, platform) => sum + platform.readiness_score, 0) / platforms.length)
      : 0;
    const totalIncidents = incidentHistory(playbook).length;
    const criticalIncidents = incidentHistory(playbook).filter((row) => row.severity === "critical").length;
    const nextAction = nextNicheAction({
      niche,
      readiness_avg: readinessAvg,
      critical_incidents: criticalIncidents,
      platforms,
    });

    return {
      niche,
      status: platforms.every((row) => row.status === "ready") ? "ready" : "watch",
      readiness_avg: readinessAvg,
      total_incidents: totalIncidents,
      critical_incidents: criticalIncidents,
      total_videos: platforms.reduce((sum, platform) => sum + platform.videos, 0),
      corpus_target: nicheTargets[niche] || 0,
      automation_history: automationRunHistory(playbook).slice(0, 5),
      platforms,
      next_action: nextAction.action,
      next_action_priority: nextAction.priority,
      next_action_reason: nextAction.reason,
      next_action_platform: nextAction.platform,
      next_action_query: nextAction.query,
    };
  }));

  const queue = [...rows]
    .sort((a, b) =>
      String(a.next_action_priority).localeCompare(String(b.next_action_priority))
      || b.critical_incidents - a.critical_incidents
      || a.readiness_avg - b.readiness_avg
      || a.niche.localeCompare(b.niche),
    )
    .slice(0, 5)
    .map((row) => ({
      niche: row.niche,
      priority: row.next_action_priority,
      action: row.next_action,
      reason: row.next_action_reason,
      platform: row.next_action_platform,
      query: row.next_action_query,
      retry_signal: row.platforms.find((platform) => platform.platform === row.next_action_platform)?.retry_signal || null,
      provider_shift: row.platforms.find((platform) => platform.platform === row.next_action_platform)?.provider_shift || null,
    }));
  const totalVideos = rows.reduce((sum, row) => sum + row.total_videos, 0);
  const totalProgress = corpusProgress({ current: totalVideos, target: REELS_BRAIN_CORPUS_TARGET_TOTAL });
  const stage = corpusStage(totalVideos);
  const platformProgress = (["tiktok", "instagram", "youtube"] as const).map((platform) => {
    const current = rows.reduce((sum, row) =>
      sum + ((row.platforms.find((item) => item.platform === platform)?.videos as number | undefined) || 0), 0);
    return {
      platform,
      ...corpusProgress({ current, target: platformTargets[platform] }),
    };
  });
  const nicheProgress = rows.map((row) => ({
    niche: row.niche,
    ...corpusProgress({ current: row.total_videos, target: row.corpus_target }),
  }));
  const executionPlan = corpusExecutionPlan({
    currentTotal: totalVideos,
    targetTotal: REELS_BRAIN_CORPUS_TARGET_TOTAL,
    horizonDays: 42,
    platforms: platformProgress.map((row) => ({
      platform: row.platform,
      current: row.current,
      target: row.target,
    })),
    niches: rows.map((row) => ({
      niche: row.niche,
      current: row.total_videos,
      target: row.corpus_target,
    })),
  });

  return {
    niches: rows,
    portfolio: {
      total_niches: rows.length,
      ready_niches: rows.filter((row) => row.status === "ready").length,
      watch_niches: rows.filter((row) => row.status !== "ready").length,
      critical_incidents: rows.reduce((sum, row) => sum + row.critical_incidents, 0),
      avg_readiness: rows.length ? Math.round(rows.reduce((sum, row) => sum + row.readiness_avg, 0) / rows.length) : 0,
      action_queue: queue,
      corpus_goal: {
        total_target: REELS_BRAIN_CORPUS_TARGET_TOTAL,
        total_progress: totalProgress,
        stage,
        by_platform: platformProgress,
        by_niche: nicheProgress,
        execution_plan: executionPlan,
      },
    },
  };
}
