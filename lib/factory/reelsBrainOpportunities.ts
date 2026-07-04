type SegmentTrustRow = {
  niche?: string;
  platform?: string;
  score?: number;
  status?: "ready" | "warming" | "weak" | string;
  confidence?: "high" | "medium" | "low" | string;
  note?: string;
};

type GroupRow = {
  niche?: string;
  platform?: string;
  recommended_mode?: "primary" | "control_only" | "research_only" | string;
  primary_allowed?: boolean;
  trust_score?: number;
  primary?: {
    title?: string;
    hook?: string;
    hypothesis?: string;
    creative_brief?: {
      hook?: string;
    };
  } | null;
};

type SegmentOutputRow = {
  niche?: string;
  platform?: string;
  primary?: {
    title?: string;
    hook?: string;
    hypothesis?: string;
    decision?: string;
    creative_brief?: {
      hook?: string;
    };
  } | null;
  cards?: Array<{
    title?: string;
    hypothesis?: string;
  }>;
};

type NicheSummaryRow = {
  niche: string;
  total_videos?: number;
  analyzed_videos?: number;
  generator_ready_patterns?: number;
  understanding_score?: number;
  platform_brains?: Record<string, {
    total_videos?: number;
    analyzed_videos?: number;
    patterns?: number;
    generator_ready_patterns?: number;
  }>;
};

function num(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function joinKey(niche: string, platform: string) {
  return `${niche}__${platform}`;
}

function recommendationMode(nicheStatus: string, platformStatus: string) {
  if (nicheStatus === "ready" && platformStatus === "ready") return "primary";
  if (nicheStatus === "weak" || platformStatus === "weak") return "research_only";
  return "control_only";
}

function opportunityStatus(score: number, readyPatterns: number, analyzed: number) {
  if (score >= 78 && readyPatterns >= 4 && analyzed >= 40) return "scale_now";
  if (score >= 52 && readyPatterns >= 1 && analyzed >= 15) return "build_next";
  return "collect_more";
}

export function buildReelsBrainOpportunities(input: {
  nicheSummaries: NicheSummaryRow[];
  segmentTrust: {
    by_niche?: SegmentTrustRow[];
    by_platform?: SegmentTrustRow[];
  };
  briefPackGroups?: {
    by_niche?: GroupRow[];
    by_platform?: GroupRow[];
  };
  actionPackGroups?: {
    by_niche?: GroupRow[];
    by_platform?: GroupRow[];
  };
  hypothesisBankGroups?: {
    by_niche?: GroupRow[];
    by_platform?: GroupRow[];
  };
  segmentOutputBanks?: {
    briefs?: SegmentOutputRow[];
    actions?: SegmentOutputRow[];
    hypotheses?: SegmentOutputRow[];
  };
  platforms?: string[];
  limit?: number;
}) {
  const nicheTrustByKey = new Map((input.segmentTrust.by_niche || []).map((row) => [text(row.niche), row]));
  const platformTrustByKey = new Map((input.segmentTrust.by_platform || []).map((row) => [text(row.platform), row]));
  const briefByNiche = new Map((input.briefPackGroups?.by_niche || []).map((row) => [text(row.niche), row]));
  const briefByPlatform = new Map((input.briefPackGroups?.by_platform || []).map((row) => [text(row.platform), row]));
  const actionByNiche = new Map((input.actionPackGroups?.by_niche || []).map((row) => [text(row.niche), row]));
  const actionByPlatform = new Map((input.actionPackGroups?.by_platform || []).map((row) => [text(row.platform), row]));
  const hypothesisByNiche = new Map((input.hypothesisBankGroups?.by_niche || []).map((row) => [text(row.niche), row]));
  const hypothesisByPlatform = new Map((input.hypothesisBankGroups?.by_platform || []).map((row) => [text(row.platform), row]));
  const briefBySegment = new Map((input.segmentOutputBanks?.briefs || []).map((row) => [joinKey(text(row.niche), text(row.platform)), row]));
  const actionBySegment = new Map((input.segmentOutputBanks?.actions || []).map((row) => [joinKey(text(row.niche), text(row.platform)), row]));
  const hypothesisBySegment = new Map((input.segmentOutputBanks?.hypotheses || []).map((row) => [joinKey(text(row.niche), text(row.platform)), row]));
  const platforms = input.platforms || ["tiktok", "instagram", "youtube"];

  const opportunities = input.nicheSummaries.flatMap((nicheRow) =>
    platforms.map((platform) => {
      const niche = nicheRow.niche;
      const platformRow = nicheRow.platform_brains?.[platform] || {};
      const nicheTrust = nicheTrustByKey.get(niche) || {};
      const platformTrust = platformTrustByKey.get(platform) || {};
      const segmentKey = joinKey(niche, platform);
      const readyPatterns = num(platformRow.generator_ready_patterns);
      const analyzed = num(platformRow.analyzed_videos);
      const total = num(platformRow.total_videos);
      const analyzedRate = total > 0 ? Math.round((analyzed / total) * 100) : 0;
      const score = clamp(
        num(nicheTrust.score) * 0.42
        + num(platformTrust.score) * 0.32
        + Math.min(14, readyPatterns * 3)
        + Math.min(12, analyzedRate * 0.12)
        + Math.min(10, num(platformRow.patterns) * 1.4),
      );
      const mode = recommendationMode(text(nicheTrust.status), text(platformTrust.status));
      const briefNiche = briefByNiche.get(niche);
      const briefPlatform = briefByPlatform.get(platform);
      const actionNiche = actionByNiche.get(niche);
      const actionPlatform = actionByPlatform.get(platform);
      const hypothesisNiche = hypothesisByNiche.get(niche);
      const hypothesisPlatform = hypothesisByPlatform.get(platform);
      const briefSegment = briefBySegment.get(segmentKey);
      const actionSegment = actionBySegment.get(segmentKey);
      const hypothesisSegment = hypothesisBySegment.get(segmentKey);
      const primaryHypothesisCard = (hypothesisSegment?.cards || [])[0] || null;
      return {
        niche,
        platform,
        opportunity_score: score,
        status: opportunityStatus(score, readyPatterns, analyzed),
        recommended_mode: mode,
        total_videos: total,
        analyzed_videos: analyzed,
        analyzed_rate: analyzedRate,
        generator_ready_patterns: readyPatterns,
        patterns: num(platformRow.patterns),
        niche_trust_score: num(nicheTrust.score),
        platform_trust_score: num(platformTrust.score),
        niche_trust_status: text(nicheTrust.status),
        platform_trust_status: text(platformTrust.status),
        niche_note: text(nicheTrust.note),
        platform_note: text(platformTrust.note),
        best_brief_title: text(briefSegment?.primary?.title || briefPlatform?.primary?.title || briefNiche?.primary?.title),
        best_brief_hook: text(
          briefSegment?.primary?.creative_brief?.hook
          || briefSegment?.primary?.hook
          || briefPlatform?.primary?.creative_brief?.hook
          || briefPlatform?.primary?.hook
          || briefNiche?.primary?.creative_brief?.hook
          || briefNiche?.primary?.hook,
        ),
        best_action_title: text(actionSegment?.primary?.title || actionPlatform?.primary?.title || actionNiche?.primary?.title),
        best_hypothesis_title: text(primaryHypothesisCard?.title || hypothesisPlatform?.primary?.title || hypothesisNiche?.primary?.title),
        best_hypothesis: text(primaryHypothesisCard?.hypothesis || hypothesisPlatform?.primary?.hypothesis || hypothesisNiche?.primary?.hypothesis),
      };
    }),
  )
    .filter((row) => row.total_videos > 0 || row.analyzed_videos > 0 || row.generator_ready_patterns > 0)
    .sort((a, b) =>
      b.opportunity_score - a.opportunity_score
      || b.generator_ready_patterns - a.generator_ready_patterns
      || b.analyzed_videos - a.analyzed_videos
      || a.niche.localeCompare(b.niche)
      || a.platform.localeCompare(b.platform),
    );

  return {
    top: opportunities.slice(0, Math.max(4, input.limit || 8)),
    summary: {
      total: opportunities.length,
      scale_now: opportunities.filter((row) => row.status === "scale_now").length,
      build_next: opportunities.filter((row) => row.status === "build_next").length,
      collect_more: opportunities.filter((row) => row.status === "collect_more").length,
      primary: opportunities.filter((row) => row.recommended_mode === "primary").length,
      control_only: opportunities.filter((row) => row.recommended_mode === "control_only").length,
      research_only: opportunities.filter((row) => row.recommended_mode === "research_only").length,
    },
  };
}
