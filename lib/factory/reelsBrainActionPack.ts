export type ReelsBrainActionPattern = {
  id?: string;
  title?: string;
  hook?: string;
  format?: string;
  retention?: string;
  op_score?: number;
  confidence?: "high" | "medium" | "low" | string;
  quality_gate?: string;
  effective_quality_gate?: string;
  final_decision?: "scale" | "control" | "watch" | string;
  niches?: string[];
  platforms?: string[];
  warnings?: string[];
  creative_brief?: {
    hook?: string;
    retention_mechanic?: string;
    structure?: string;
    visual_recipe?: string[];
    audio_strategy?: string[];
    product_fit?: string[];
    copy_as_mechanic?: string[];
    do_not_copy?: string[];
  } | null;
  market_signal?: {
    status?: "proven" | "promising" | "weak" | "no_feedback" | string;
    confidence?: "high" | "medium" | "low" | string;
    best_platform?: string | null;
    winners?: number | null;
    losers?: number | null;
    total_posts?: number | null;
    why?: string[] | null;
  } | null;
};

type SegmentPriorityRow = {
  niche?: string;
  platform?: string;
  decision_priority_score?: number;
  urgency_score?: number;
  ready_for_generation?: boolean;
  policy_mode?: string;
  recommended_upgrade?: {
    projected_trust_gain_score?: number;
    projected_production_state?: string;
    unlocked_output?: string;
  } | null;
};

type SegmentPolicyRow = {
  niche?: string;
  platform?: string;
  policy_mode?: string;
  trust_band?: string;
  evidence_band?: string;
  high_trust_generation_ready?: boolean;
  proof_quality?: string;
  publishable_exact?: boolean;
  outcome_status?: string;
  outcome_confidence?: string;
  policy_reason?: string;
  decision_priority_score?: number;
  recommended_upgrade?: {
    projected_trust_gain_score?: number;
    projected_production_state?: string;
    unlocked_output?: string;
  } | null;
  next_upgrade?: {
    projected_trust_gain_score?: number;
    projected_production_state?: string;
    unlocked_output?: string;
  } | null;
};

function liveQualityGate(pattern: ReelsBrainActionPattern) {
  return text(pattern.effective_quality_gate || pattern.quality_gate, "unknown");
}

export type ReelsBrainActionCard = {
  rank: number;
  pattern_id: string;
  title: string;
  decision: "scale" | "control" | "watch";
  market_status: "proven" | "promising" | "weak" | "no_feedback";
  confidence: "high" | "medium" | "low";
  priority_score: number;
  segment_priority_score: number;
  segment_priority_mode: string;
  segment_priority_label: string;
  segment_ready_for_generation: boolean;
  trust_band: string;
  evidence_band: string;
  proof_quality: string;
  high_trust_generation_ready: boolean;
  publishable_exact: boolean;
  policy_reason: string;
  projected_trust_gain_score: number;
  projected_production_state: string;
  unlocked_output: string;
  op_score: number;
  why_now: string[];
  success_metric: string;
  guardrails: string[];
  brief_seed: {
    hook: string;
    retention: string;
    structure: string;
    visual_recipe: string[];
    audio_strategy: string[];
    product_fit: string[];
  };
};

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() || fallback : fallback;
}

function list(value: unknown, limit = 4): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => text(item)).filter(Boolean).slice(0, limit);
}

function segmentPairs(input: Array<{ niches?: string[]; platforms?: string[] }>) {
  const pairs = new Map<string, { niche: string; platform: string }>();
  for (const item of input) {
    for (const niche of list(item.niches, 20)) {
      for (const platform of list(item.platforms, 20)) {
        pairs.set(`${niche}__${platform}`, { niche, platform });
      }
    }
  }
  return Array.from(pairs.values()).sort((a, b) =>
    a.niche.localeCompare(b.niche) || a.platform.localeCompare(b.platform),
  );
}

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizeDecision(value: unknown): "scale" | "control" | "watch" {
  const raw = text(value).toLowerCase();
  if (raw === "scale") return "scale";
  if (raw === "control" || raw === "control_only") return "control";
  return "watch";
}

function normalizeMarketStatus(value: unknown): "proven" | "promising" | "weak" | "no_feedback" {
  const raw = text(value).toLowerCase();
  if (raw === "proven" || raw === "promising" || raw === "weak") return raw;
  return "no_feedback";
}

function normalizeConfidence(value: unknown): "high" | "medium" | "low" {
  const raw = text(value).toLowerCase();
  if (raw === "high" || raw === "medium") return raw;
  return "low";
}

function policyModeScore(value: unknown) {
  const raw = text(value).toLowerCase();
  if (raw === "primary") return 3;
  if (raw === "control_only") return 2;
  return 1;
}

function proofQualityRank(value: unknown) {
  const raw = text(value).toLowerCase();
  if (raw === "exact_segment") return 4;
  if (raw === "publishable_exact") return 3;
  if (raw === "transfer_guarded") return 2;
  if (raw === "transfer") return 1;
  return 0;
}

function priorityScore(pattern: ReelsBrainActionPattern) {
  const op = Math.min(100, num(pattern.op_score));
  const decisionBoost = normalizeDecision(pattern.final_decision) === "scale"
    ? 18
    : normalizeDecision(pattern.final_decision) === "control"
      ? 8
      : 0;
  const marketBoost = normalizeMarketStatus(pattern.market_signal?.status) === "proven"
    ? 16
    : normalizeMarketStatus(pattern.market_signal?.status) === "promising"
      ? 8
      : normalizeMarketStatus(pattern.market_signal?.status) === "weak"
        ? -10
        : 0;
  const confidenceBoost = normalizeConfidence(pattern.market_signal?.confidence || pattern.confidence) === "high"
    ? 8
    : normalizeConfidence(pattern.market_signal?.confidence || pattern.confidence) === "medium"
      ? 4
      : 0;
  return clamp(op + decisionBoost + marketBoost + confidenceBoost - Math.min(12, list(pattern.warnings, 6).length * 3));
}

function sortActionCards<T extends {
  segment_priority_mode?: string;
  segment_priority_score?: number;
  high_trust_generation_ready?: boolean;
  publishable_exact?: boolean;
  proof_quality?: string;
  priority_score?: number;
  op_score?: number;
  title?: string;
}>(rows: T[]) {
  return rows.sort((a, b) =>
    policyModeScore(b.segment_priority_mode) - policyModeScore(a.segment_priority_mode)
    || Number(Boolean(b.high_trust_generation_ready)) - Number(Boolean(a.high_trust_generation_ready))
    || Number(Boolean(b.publishable_exact)) - Number(Boolean(a.publishable_exact))
    || proofQualityRank(b.proof_quality) - proofQualityRank(a.proof_quality)
    || num(b.segment_priority_score) - num(a.segment_priority_score)
    || num(b.priority_score) - num(a.priority_score)
    || num(b.op_score) - num(a.op_score)
    || text(a.title).localeCompare(text(b.title)));
}

function whyNow(pattern: ReelsBrainActionPattern): string[] {
  const reasons = [
    `OP ${num(pattern.op_score)} · gate ${liveQualityGate(pattern)}.`,
  ];
  if (normalizeMarketStatus(pattern.market_signal?.status) !== "no_feedback") {
    reasons.push(`Market ${normalizeMarketStatus(pattern.market_signal?.status)} · winners ${num(pattern.market_signal?.winners)} / posts ${num(pattern.market_signal?.total_posts)}.`);
  }
  if (text(pattern.market_signal?.best_platform)) {
    reasons.push(`Лучший market-fit сейчас на ${text(pattern.market_signal?.best_platform)}.`);
  }
  return reasons.slice(0, 3);
}

function successMetric(pattern: ReelsBrainActionPattern) {
  const decision = normalizeDecision(pattern.final_decision);
  if (decision === "scale") return "Подтвердить, что новый ролик не хуже текущих winner-patterns по удержанию и коммерческому сигналу.";
  if (decision === "control") return "Обогнать baseline по hook rate, completion или CTR без просадки по quality.";
  return "Поймать первый сильный сигнал по first-stop, saves или досмотру без явного anti-pattern drift.";
}

function guardrails(pattern: ReelsBrainActionPattern) {
  const base = [
    ...list(pattern.warnings, 4),
    ...list(pattern.creative_brief?.do_not_copy, 3),
  ];
  return Array.from(new Set(base.filter(Boolean))).slice(0, 5);
}

function briefSeed(pattern: ReelsBrainActionPattern) {
  return {
    hook: text(pattern.creative_brief?.hook || pattern.hook, "сильный хук"),
    retention: text(pattern.creative_brief?.retention_mechanic || pattern.retention, "удержание"),
    structure: text(pattern.creative_brief?.structure || pattern.format, "демонстрация"),
    visual_recipe: list(pattern.creative_brief?.visual_recipe, 4),
    audio_strategy: list(pattern.creative_brief?.audio_strategy, 3),
    product_fit: list(pattern.creative_brief?.product_fit, 3),
  };
}

function segmentSignal(
  pattern: ReelsBrainActionPattern,
  segmentPriorityMap: Map<string, SegmentPriorityRow>,
  segmentPolicyMap: Map<string, SegmentPolicyRow>,
) {
  const pairs = segmentPairs([pattern]);
  return pairs.map(({ niche, platform }) => {
    const key = `${niche}__${platform}`;
    const priority = segmentPriorityMap.get(key);
    const policy = segmentPolicyMap.get(key);
    const upgrade = policy?.recommended_upgrade || policy?.next_upgrade || priority?.recommended_upgrade || null;
    const priorityScore = Math.max(
      num(priority?.decision_priority_score),
      num(priority?.urgency_score),
      num(policy?.decision_priority_score),
      num(upgrade?.projected_trust_gain_score),
    );
    return {
      label: `${niche} × ${platform}`,
      segment_priority_score: priorityScore,
      segment_priority_mode: text(priority?.policy_mode || policy?.policy_mode, "research_only"),
      segment_ready_for_generation: Boolean(priority?.ready_for_generation),
      trust_band: text(policy?.trust_band, "unknown"),
      evidence_band: text(policy?.evidence_band, "unknown"),
      proof_quality: text(policy?.proof_quality, "untraced"),
      high_trust_generation_ready: Boolean(policy?.high_trust_generation_ready),
      publishable_exact: Boolean(policy?.publishable_exact),
      policy_reason: text(policy?.policy_reason),
      projected_trust_gain_score: num(upgrade?.projected_trust_gain_score),
      projected_production_state: text(upgrade?.projected_production_state),
      unlocked_output: text(upgrade?.unlocked_output),
    };
  }).sort((a, b) =>
    policyModeScore(b.segment_priority_mode) - policyModeScore(a.segment_priority_mode)
    || Number(Boolean(b.high_trust_generation_ready)) - Number(Boolean(a.high_trust_generation_ready))
    || Number(Boolean(b.publishable_exact)) - Number(Boolean(a.publishable_exact))
    || proofQualityRank(b.proof_quality) - proofQualityRank(a.proof_quality)
    || b.segment_priority_score - a.segment_priority_score
    || Number(b.segment_ready_for_generation) - Number(a.segment_ready_for_generation)
    || b.projected_trust_gain_score - a.projected_trust_gain_score
    || a.label.localeCompare(b.label),
  )[0] || null;
}

export function buildReelsBrainActionPack(
  patterns: ReelsBrainActionPattern[],
  limit = 4,
  options?: {
    segmentPriorityQueue?: SegmentPriorityRow[];
    generationPolicy?: {
      by_segment?: SegmentPolicyRow[];
    } | null;
  },
) {
  const segmentPriorityMap = new Map((options?.segmentPriorityQueue || []).map((row) => [`${text(row.niche)}__${text(row.platform)}`, row]));
  const segmentPolicyMap = new Map((((options?.generationPolicy?.by_segment) || []) as SegmentPolicyRow[]).map((row) => [`${text(row.niche)}__${text(row.platform)}`, row]));
  const cards = sortActionCards([...patterns]
    .map((pattern, index) => ({
      ...(() => {
        const priority = segmentSignal(pattern, segmentPriorityMap, segmentPolicyMap);
        return {
          segment_priority_score: priority?.segment_priority_score || 0,
          segment_priority_mode: priority?.segment_priority_mode || "research_only",
          segment_priority_label: priority?.label || "",
          segment_ready_for_generation: priority?.segment_ready_for_generation || false,
          trust_band: priority?.trust_band || "unknown",
          evidence_band: priority?.evidence_band || "unknown",
          proof_quality: priority?.proof_quality || "untraced",
          high_trust_generation_ready: priority?.high_trust_generation_ready || false,
          publishable_exact: priority?.publishable_exact || false,
          policy_reason: priority?.policy_reason || "",
          projected_trust_gain_score: priority?.projected_trust_gain_score || 0,
          projected_production_state: priority?.projected_production_state || "",
          unlocked_output: priority?.unlocked_output || "",
        };
      })(),
      rank: index + 1,
      pattern_id: text(pattern.id, `pattern_${index + 1}`),
      title: text(pattern.title, `Pattern ${index + 1}`),
      decision: normalizeDecision(pattern.final_decision),
      market_status: normalizeMarketStatus(pattern.market_signal?.status),
      confidence: normalizeConfidence(pattern.market_signal?.confidence || pattern.confidence),
      priority_score: priorityScore(pattern),
      op_score: num(pattern.op_score),
      why_now: whyNow(pattern),
      success_metric: successMetric(pattern),
      guardrails: guardrails(pattern),
      brief_seed: briefSeed(pattern),
    } satisfies ReelsBrainActionCard)))
    .slice(0, Math.max(1, limit))
    .map((card, index) => ({ ...card, rank: index + 1 }));

  return {
    primary: cards[0] || null,
    alternatives: cards.slice(1),
    summary: {
      total: cards.length,
      scale: cards.filter((card) => card.decision === "scale").length,
      control: cards.filter((card) => card.decision === "control").length,
      watch: cards.filter((card) => card.decision === "watch").length,
      proven: cards.filter((card) => card.market_status === "proven").length,
      promising: cards.filter((card) => card.market_status === "promising").length,
      weak: cards.filter((card) => card.market_status === "weak").length,
      no_feedback: cards.filter((card) => card.market_status === "no_feedback").length,
      primary_policy_mode: text(cards[0]?.segment_priority_mode, "research_only"),
      primary_segment_priority_score: num(cards[0]?.segment_priority_score),
      ready_for_generation: cards.filter((card) => card.segment_ready_for_generation).length,
      exact_proof_ready: cards.filter((card) => card.publishable_exact).length,
      generation_ready: cards.filter((card) => card.high_trust_generation_ready).length,
      rollout_order: cards.map((card) => ({
        rank: card.rank,
        pattern_id: card.pattern_id,
        priority_score: card.priority_score,
        decision: card.decision,
        proof_quality: card.proof_quality,
      })),
    },
  };
}

export function buildGroupedReelsBrainActionPacks(input: {
  patterns: ReelsBrainActionPattern[];
  niches?: string[];
  platforms?: string[];
  limit?: number;
  segmentPriorityQueue?: SegmentPriorityRow[];
  generationPolicy?: {
    by_segment?: SegmentPolicyRow[];
  } | null;
}) {
  const patterns = input.patterns || [];
  const niches = Array.from(new Set((input.niches || patterns.flatMap((pattern) => list(pattern.niches, 20))).filter(Boolean))).sort();
  const platforms = Array.from(new Set((input.platforms || patterns.flatMap((pattern) => list(pattern.platforms, 20))).filter(Boolean))).sort();
  const options = {
    segmentPriorityQueue: input.segmentPriorityQueue,
    generationPolicy: input.generationPolicy,
  };
  const sortGroups = <T extends { primary?: { segment_priority_mode?: string; high_trust_generation_ready?: boolean; publishable_exact?: boolean; proof_quality?: string; segment_priority_score?: number; priority_score?: number; op_score?: number; title?: string } | null }>(rows: T[]) =>
    rows.sort((a, b) =>
      policyModeScore(b.primary?.segment_priority_mode) - policyModeScore(a.primary?.segment_priority_mode)
      || Number(Boolean(b.primary?.high_trust_generation_ready)) - Number(Boolean(a.primary?.high_trust_generation_ready))
      || Number(Boolean(b.primary?.publishable_exact)) - Number(Boolean(a.primary?.publishable_exact))
      || proofQualityRank(b.primary?.proof_quality) - proofQualityRank(a.primary?.proof_quality)
      || num(b.primary?.segment_priority_score) - num(a.primary?.segment_priority_score)
      || num(b.primary?.priority_score) - num(a.primary?.priority_score)
      || num(b.primary?.op_score) - num(a.primary?.op_score)
      || text(a.primary?.title).localeCompare(text(b.primary?.title)),
    );
  return {
    by_niche: sortGroups(niches.map((niche) => ({
      niche,
      ...buildReelsBrainActionPack(
        patterns.filter((pattern) => list(pattern.niches, 20).includes(niche)),
        input.limit || 3,
        options,
      ),
    })).filter((row) => row.primary)),
    by_platform: sortGroups(platforms.map((platform) => ({
      platform,
      ...buildReelsBrainActionPack(
        patterns.filter((pattern) => list(pattern.platforms, 20).includes(platform)),
        input.limit || 3,
        options,
      ),
    })).filter((row) => row.primary)),
    by_segment: sortGroups(segmentPairs(patterns).map(({ niche, platform }) => ({
      niche,
      platform,
      ...buildReelsBrainActionPack(
        patterns.filter((pattern) =>
          list(pattern.niches, 20).includes(niche) && list(pattern.platforms, 20).includes(platform)),
        input.limit || 3,
        options,
      ),
    })).filter((row) => row.primary)),
  };
}
