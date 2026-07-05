type OpportunityRow = {
  niche?: string;
  platform?: string;
  opportunity_score?: number;
  status?: "scale_now" | "build_next" | "collect_more" | string;
  recommended_mode?: "primary" | "control_only" | "research_only" | string;
  best_brief_title?: string;
  best_brief_hook?: string;
  best_action_title?: string;
  best_hypothesis_title?: string;
  best_hypothesis?: string;
  niche_note?: string;
  platform_note?: string;
};

type AtlasPattern = {
  title?: string;
  hook?: string;
  retention?: string;
  format?: string;
  final_decision?: string;
  market_status?: string;
  stability_score?: number;
  brief_seed?: {
    hook?: string;
    retention?: string;
    visual_recipe?: string[];
    audio_strategy?: string[];
    product_fit?: string[];
    do_not_copy?: string[];
  };
};

type AtlasSegment = {
  niche?: string;
  platform?: string;
  status?: "stable" | "forming" | "thin" | string;
  recommended_mode?: "primary" | "control_only" | "research_only" | string;
  avg_stability_score?: number;
  stable_pattern_count?: number;
  analyzed_videos?: number;
  total_videos?: number;
  next_step?: string;
  top_patterns?: AtlasPattern[];
};

type SegmentOutcomeRow = {
  niche?: string;
  platform?: string;
  segment?: string;
  status?: "proven" | "promising" | "weak" | "no_feedback" | string;
  posts?: number;
  winners?: number;
  losers?: number;
  traced_posts?: number;
  exact_segment_posts?: number;
  pattern_feedback_posts?: number;
  unscoped_posts?: number;
  proof_quality?: "exact_segment" | "traced_transfer_only" | "untraced" | string;
  trust_action?: string;
};

function num(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function list(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => text(item)).filter(Boolean)
    : [];
}

function joinKey(niche: string, platform: string) {
  return `${niche}__${platform}`;
}

function modeRank(mode: string) {
  if (mode === "primary") return 3;
  if (mode === "control_only") return 2;
  return 1;
}

function playbookStatus(opportunityStatus: string, atlasStatus: string, outcomeStatus: string) {
  if (outcomeStatus === "weak") return opportunityStatus === "scale_now" ? "prepare" : "research";
  if (opportunityStatus === "scale_now" && atlasStatus === "stable") return "ship_now";
  if ((opportunityStatus === "scale_now" || opportunityStatus === "build_next") && (atlasStatus === "stable" || atlasStatus === "forming")) return "validate_and_ship";
  if (opportunityStatus === "build_next") return "prepare";
  return "research";
}

function normalizeProofQuality(value: unknown) {
  const raw = text(value);
  if (raw === "exact_segment") return "exact_segment";
  if (raw === "traced_transfer_only") return "traced_transfer_only";
  return "untraced";
}

export function buildReelsBrainSegmentPlaybook(input: {
  opportunities?: { top?: OpportunityRow[] };
  patternAtlas?: { by_segment?: AtlasSegment[] };
  feedbackLoop?: { by_segment?: SegmentOutcomeRow[] };
  limit?: number;
}) {
  const opportunityMap = new Map(
    (input.opportunities?.top || [])
      .map((row) => [joinKey(text(row.niche), text(row.platform)), row] as const),
  );
  const outcomeMap = new Map(
    (input.feedbackLoop?.by_segment || [])
      .map((row) => [joinKey(text(row.niche), text(row.platform)), row] as const),
  );

  const rows = (input.patternAtlas?.by_segment || [])
    .map((segment) => {
      const niche = text(segment.niche);
      const platform = text(segment.platform);
      const opportunity = opportunityMap.get(joinKey(niche, platform)) || {};
      const outcome = outcomeMap.get(joinKey(niche, platform)) || {};
      const topPattern = segment.top_patterns?.[0] || {};
      const outcomeStatus = text(outcome.status || topPattern.market_status || "no_feedback");
      const proofQuality = normalizeProofQuality(outcome.proof_quality);
      const baseStatus = playbookStatus(text(opportunity.status), text(segment.status), outcomeStatus);
      const status = baseStatus === "ship_now" && proofQuality !== "exact_segment"
        ? "validate_and_ship"
        : baseStatus;
      const mode = outcomeStatus === "weak"
        ? "research_only"
        : proofQuality === "untraced" && text(opportunity.recommended_mode || segment.recommended_mode || "research_only") === "primary"
          ? "control_only"
        : text(opportunity.recommended_mode || segment.recommended_mode || "research_only");
      const coverage = num(segment.total_videos) > 0
        ? Math.round((num(segment.analyzed_videos) / num(segment.total_videos)) * 100)
        : 0;

      return {
        niche,
        platform,
        status,
        recommended_mode: mode,
        opportunity_score: num(opportunity.opportunity_score),
        stability_score: num(segment.avg_stability_score),
        stable_pattern_count: num(segment.stable_pattern_count),
        coverage_rate: coverage,
        segment_outcome_status: outcomeStatus,
        segment_outcome_posts: num(outcome.posts),
        segment_outcome_winners: num(outcome.winners),
        segment_outcome_losers: num(outcome.losers),
        segment_outcome_traced_posts: num(outcome.traced_posts),
        segment_outcome_exact_posts: num(outcome.exact_segment_posts),
        segment_outcome_pattern_feedback_posts: num(outcome.pattern_feedback_posts),
        segment_outcome_unscoped_posts: num(outcome.unscoped_posts),
        segment_outcome_proof_quality: proofQuality,
        segment_outcome_trust_action: text(outcome.trust_action),
        leading_pattern: {
          title: text(topPattern.title),
          hook: text(topPattern.hook),
          retention: text(topPattern.retention),
          format: text(topPattern.format),
          decision: text(topPattern.final_decision),
          market_status: outcomeStatus,
          brief_seed: {
            hook: text(topPattern.brief_seed?.hook || topPattern.hook),
            retention: text(topPattern.brief_seed?.retention || topPattern.retention),
            visual_recipe: list(topPattern.brief_seed?.visual_recipe).slice(0, 3),
            audio_strategy: list(topPattern.brief_seed?.audio_strategy).slice(0, 3),
            product_fit: list(topPattern.brief_seed?.product_fit).slice(0, 3),
            do_not_copy: list(topPattern.brief_seed?.do_not_copy).slice(0, 3),
          },
        },
        brief: {
          title: text(opportunity.best_brief_title),
          hook: text(opportunity.best_brief_hook || topPattern.brief_seed?.hook || topPattern.hook),
        },
        hypothesis: {
          title: text(opportunity.best_hypothesis_title),
          text: text(opportunity.best_hypothesis),
        },
        rollout: {
          title: text(opportunity.best_action_title),
          why_now: [
            status === "ship_now"
              ? "Сегмент уже имеет stable atlas + scale-level opportunity."
              : status === "validate_and_ship"
                ? "Сигнал сильный, но лучше пройти control-валидацию перед масштабом."
                : status === "prepare"
                  ? "Сегмент почти готов, но ему нужен ещё один цикл анализа и сборки."
                  : "Пока это исследовательский сегмент: строим знания, а не масштаб.",
            outcomeStatus === "proven" ? "Outcome-публикации подтвердили сегмент." : "",
            proofQuality === "exact_segment" ? "Есть exact-segment proof по этому niche × platform." : "",
            proofQuality === "traced_transfer_only" ? "Пока есть только traced feedback без exact-segment proof." : "",
            proofQuality === "untraced" && outcomeStatus !== "no_feedback" ? "Публикации есть, но они ещё не привязаны к exact validation loop." : "",
            outcomeStatus === "promising" ? "Есть первые outcome-сигналы, но ещё нужен контроль." : "",
            outcomeStatus === "weak" ? "Outcome-публикации пока не подтверждают сегмент." : "",
          ].filter(Boolean).join(" "),
          next_step: [
            text(segment.next_step || opportunity.niche_note || opportunity.platform_note),
            proofQuality !== "exact_segment" && outcomeStatus !== "weak" ? "Добрать exact-segment proof before full-scale promotion." : "",
            outcomeStatus === "weak" ? "Не масштабировать, пока не пересобран hook/structure." : "",
          ].filter(Boolean).join(" "),
        },
      };
    })
    .filter((row) => row.leading_pattern.title || row.brief.title || row.hypothesis.text || row.rollout.title)
    .sort((a, b) =>
      modeRank(b.recommended_mode) - modeRank(a.recommended_mode)
      || b.opportunity_score - a.opportunity_score
      || b.stability_score - a.stability_score
      || b.stable_pattern_count - a.stable_pattern_count
      || a.niche.localeCompare(b.niche)
      || a.platform.localeCompare(b.platform),
    );

  return {
    summary: {
      total: rows.length,
      ship_now: rows.filter((row) => row.status === "ship_now").length,
      validate_and_ship: rows.filter((row) => row.status === "validate_and_ship").length,
      prepare: rows.filter((row) => row.status === "prepare").length,
      research: rows.filter((row) => row.status === "research").length,
      primary: rows.filter((row) => row.recommended_mode === "primary").length,
      control_only: rows.filter((row) => row.recommended_mode === "control_only").length,
      research_only: rows.filter((row) => row.recommended_mode === "research_only").length,
    },
    items: rows.slice(0, Math.max(4, input.limit || 8)),
  };
}
