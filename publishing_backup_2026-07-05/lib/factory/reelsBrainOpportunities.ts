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
    trust?: {
      trust_band?: string;
      evidence_band?: string;
      proof_quality?: string;
      high_trust_generation_ready?: boolean;
      publishable_exact?: boolean;
      policy_reason?: string;
    } | null;
  } | null;
  cards?: Array<{
    title?: string;
    hypothesis?: string;
    trust_band?: string;
    evidence_band?: string;
    proof_quality?: string;
    high_trust_generation_ready?: boolean;
    publishable_exact?: boolean;
    policy_reason?: string;
  }>;
};

type SegmentReadinessRow = {
  niche?: string;
  platform?: string;
  total_backlog?: number;
  dominant_gap?: {
    key?: string;
    count?: number;
  };
  direct_rate?: number;
  audio_rate?: number;
  transcript_ready_rate?: number;
  analyzed_rate?: number;
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

function proofQualityRank(value: unknown) {
  const raw = text(value);
  if (raw === "exact_segment") return 3;
  if (raw === "traced_transfer_only" || raw === "transfer") return 2;
  return 1;
}

function foundationState(row: SegmentReadinessRow | undefined) {
  if (!row) return { status: "unknown", score: 0, note: "readiness не собран" };
  const directRate = num(row.direct_rate);
  const audioRate = num(row.audio_rate);
  const transcriptRate = num(row.transcript_ready_rate);
  const analyzedRate = num(row.analyzed_rate);
  const totalBacklog = num(row.total_backlog);
  const dominantGap = text(row.dominant_gap?.key);
  const score = clamp(
    Math.min(28, directRate * 0.28)
    + Math.min(34, audioRate * 0.34)
    + Math.min(28, transcriptRate * 0.28)
    + Math.min(10, analyzedRate * 0.1)
    - Math.min(12, totalBacklog * 0.45),
  );
  if (audioRate >= 55 && transcriptRate >= 45 && (totalBacklog <= 0 || dominantGap === "analyze")) {
    return { status: "ready", score, note: "voice/audio foundation уже достаточно плотный" };
  }
  if (audioRate >= 30 && transcriptRate >= 20) {
    return { status: "warming", score, note: "voice/audio foundation уже собирается, но ещё не стабилен" };
  }
  return { status: "weak", score, note: "voice/audio foundation ещё слабый для уверенного масштабирования" };
}

function adjustModeByFoundation(mode: string, foundationStatus: string) {
  if (foundationStatus === "ready") return mode;
  if (foundationStatus === "warming") return mode === "primary" ? "control_only" : mode;
  if (mode === "primary" || mode === "control_only") return "research_only";
  return mode;
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
  segmentReadiness?: SegmentReadinessRow[];
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
  const readinessBySegment = new Map((input.segmentReadiness || []).map((row) => [joinKey(text(row.niche), text(row.platform)), row]));
  const platforms = input.platforms || ["tiktok", "instagram", "youtube"];

  const opportunities = input.nicheSummaries.flatMap((nicheRow) =>
    platforms.map((platform) => {
      const niche = nicheRow.niche;
      const platformRow = nicheRow.platform_brains?.[platform] || {};
      const nicheTrust = nicheTrustByKey.get(niche) || {};
      const platformTrust = platformTrustByKey.get(platform) || {};
      const segmentKey = joinKey(niche, platform);
      const foundation = foundationState(readinessBySegment.get(segmentKey));
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
      ) + (foundation.status === "ready" ? 8 : foundation.status === "warming" ? 0 : -14);
      const mode = adjustModeByFoundation(
        recommendationMode(text(nicheTrust.status), text(platformTrust.status)),
        foundation.status,
      );
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
      const briefTrust = briefSegment?.primary?.trust || null;
      const proofQuality = text(
        briefTrust?.proof_quality
        || primaryHypothesisCard?.proof_quality
        || "untraced",
      );
      const publishableExact = Boolean(
        briefTrust?.publishable_exact
        || primaryHypothesisCard?.publishable_exact,
      );
      const highTrustGenerationReady = Boolean(
        briefTrust?.high_trust_generation_ready
        || primaryHypothesisCard?.high_trust_generation_ready,
      );
      const trustBand = text(
        briefTrust?.trust_band
        || primaryHypothesisCard?.trust_band
        || nicheTrust.status
        || "unknown",
      );
      const evidenceBand = text(
        briefTrust?.evidence_band
        || primaryHypothesisCard?.evidence_band
        || "unknown",
      );
      const policyReason = text(
        briefTrust?.policy_reason
        || primaryHypothesisCard?.policy_reason
        || "",
      );
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
        foundation_status: foundation.status,
        foundation_score: foundation.score,
        foundation_note: foundation.note,
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
        proof_quality: proofQuality,
        publishable_exact: publishableExact,
        high_trust_generation_ready: highTrustGenerationReady,
        trust_band: trustBand,
        evidence_band: evidenceBand,
        policy_reason: policyReason,
      };
    }),
  )
    .filter((row) => row.total_videos > 0 || row.analyzed_videos > 0 || row.generator_ready_patterns > 0)
    .sort((a, b) =>
      Number(b.high_trust_generation_ready) - Number(a.high_trust_generation_ready)
      || Number(b.publishable_exact) - Number(a.publishable_exact)
      || proofQualityRank(b.proof_quality) - proofQualityRank(a.proof_quality)
      || b.opportunity_score - a.opportunity_score
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
      exact_proof_ready: opportunities.filter((row) => row.proof_quality === "exact_segment").length,
      generation_ready: opportunities.filter((row) => row.high_trust_generation_ready).length,
    },
  };
}
