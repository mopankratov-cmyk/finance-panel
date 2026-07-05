type PatternMarketSignal = {
  status?: "proven" | "promising" | "weak" | "no_feedback" | string;
  confidence?: "high" | "medium" | "low" | string;
  best_platform?: string | null;
  winners?: number | null;
  losers?: number | null;
  total_posts?: number | null;
  why?: string[] | null;
};

export type ReelsBrainDecisionPattern = {
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
    visual_recipe?: string[];
    second_by_second?: string[];
    audio_strategy?: string[];
    product_fit?: string[];
    copy_as_mechanic?: string[];
    do_not_copy?: string[];
  } | null;
  market_signal?: PatternMarketSignal | null;
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

function liveQualityGate(pattern: ReelsBrainDecisionPattern) {
  return text(pattern.effective_quality_gate || pattern.quality_gate, "unknown");
}

export type ReelsBrainHypothesisCard = {
  id: string;
  title: string;
  platform_focus: string[];
  niche_focus: string[];
  decision: "scale" | "control" | "watch";
  market_status: "proven" | "promising" | "weak" | "no_feedback";
  confidence: "high" | "medium" | "low";
  priority_score: number;
  segment_priority_score: number;
  segment_priority_mode: string;
  segment_priority_label: string;
  segment_ready_for_generation: boolean;
  projected_trust_gain_score: number;
  projected_production_state: string;
  unlocked_output: string;
  hypothesis: string;
  why_now: string[];
  test_plan: string[];
  success_metric: string;
  guardrails: string[];
  brief_seed: {
    hook: string;
    retention: string;
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
  return value
    .map((item) => text(item))
    .filter(Boolean)
    .slice(0, limit);
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

function priorityScore(pattern: ReelsBrainDecisionPattern) {
  const decision = normalizeDecision(pattern.final_decision);
  const market = normalizeMarketStatus(pattern.market_signal?.status);
  const confidence = normalizeConfidence(pattern.confidence || pattern.market_signal?.confidence);
  const op = Math.min(100, num(pattern.op_score));
  const decisionBoost = decision === "scale" ? 20 : decision === "control" ? 8 : 0;
  const marketBoost = market === "proven" ? 16 : market === "promising" ? 8 : market === "weak" ? -10 : 0;
  const confidenceBoost = confidence === "high" ? 10 : confidence === "medium" ? 4 : 0;
  const warningPenalty = Math.min(12, list(pattern.warnings, 6).length * 3);
  return clamp(op + decisionBoost + marketBoost + confidenceBoost - warningPenalty);
}

function sortHypothesisCards<T extends {
  segment_priority_mode?: string;
  segment_priority_score?: number;
  priority_score?: number;
  decision?: string;
  title?: string;
}>(rows: T[]) {
  return rows.sort((a, b) =>
    policyModeScore(b.segment_priority_mode) - policyModeScore(a.segment_priority_mode)
    || num(b.segment_priority_score) - num(a.segment_priority_score)
    || num(b.priority_score) - num(a.priority_score)
    || text(a.decision).localeCompare(text(b.decision))
    || text(a.title).localeCompare(text(b.title)));
}

function hypothesisText(pattern: ReelsBrainDecisionPattern) {
  const hook = text(pattern.creative_brief?.hook || pattern.hook, "сильный хук");
  const retention = text(pattern.creative_brief?.retention_mechanic || pattern.retention, "удержание через proof");
  const format = text(pattern.format, "UGC demo");
  const platforms = list(pattern.platforms, 2);
  const niches = list(pattern.niches, 2);
  return `Если дать хук "${hook}" в формате "${format}" и удерживать через "${retention}", то ${niches.join(" / ") || "эта ниша"} на ${platforms.join(" / ") || "этой платформе"} должна дать более сильный first-stop и досмотр, чем обычный прямой обзор.`;
}

function whyNow(pattern: ReelsBrainDecisionPattern): string[] {
  const out = [
    `OP score ${num(pattern.op_score)} и gate ${liveQualityGate(pattern)}.`,
  ];
  const market = pattern.market_signal;
  if (market && normalizeMarketStatus(market.status) !== "no_feedback") {
    out.push(`Market signal: ${normalizeMarketStatus(market.status)} · winners ${num(market.winners)} / posts ${num(market.total_posts)}.`);
  }
  if (text(market?.best_platform)) {
    out.push(`Лучшая платформа по обратной связи: ${text(market?.best_platform)}.`);
  }
  return out.slice(0, 3);
}

function testPlan(pattern: ReelsBrainDecisionPattern): string[] {
  const decision = normalizeDecision(pattern.final_decision);
  const hook = text(pattern.creative_brief?.hook || pattern.hook, "сильный хук");
  const retention = text(pattern.creative_brief?.retention_mechanic || pattern.retention, "proof");
  return [
    `Собрать control-ролик вокруг хука "${hook}" без копирования чужого текста и музыки.`,
    `Оставить механику удержания "${retention}" неизменной, а тестировать только первый кадр и proof-блок.`,
    decision === "scale"
      ? "Сразу делать серию из 3-5 вариаций для одной ниши и платформы."
      : decision === "control"
        ? "Пустить как контролируемый A/B тест против текущего baseline."
        : "Использовать только как разведочный тест, без масштабирования бюджета.",
  ];
}

function successMetric(pattern: ReelsBrainDecisionPattern): string {
  const decision = normalizeDecision(pattern.final_decision);
  if (decision === "scale") return "Успех: ролик подтверждает first-stop, досмотр и коммерческий сигнал не хуже текущих winner-постов.";
  if (decision === "control") return "Успех: ролик обгоняет baseline по удержанию или CTR и не ловит anti-pattern сигналы.";
  return "Успех: появляется первый сильный сигнал по hook rate, retention или saves без негативного feedback.";
}

function guardrails(pattern: ReelsBrainDecisionPattern): string[] {
  const warnings = list(pattern.warnings, 4);
  const doNotCopy = list(pattern.creative_brief?.do_not_copy, 3);
  const base = [
    "Не копировать дословный текст, музыку, персонажа и покадровый монтаж референса.",
    ...doNotCopy,
    ...warnings,
  ];
  return Array.from(new Set(base.filter(Boolean))).slice(0, 5);
}

function briefSeed(pattern: ReelsBrainDecisionPattern) {
  return {
    hook: text(pattern.creative_brief?.hook || pattern.hook, "сильный хук"),
    retention: text(pattern.creative_brief?.retention_mechanic || pattern.retention, "удержание через proof"),
    visual_recipe: list(pattern.creative_brief?.visual_recipe, 4),
    audio_strategy: list(pattern.creative_brief?.audio_strategy, 3),
    product_fit: list(pattern.creative_brief?.product_fit, 3),
  };
}

function segmentSignal(
  pattern: ReelsBrainDecisionPattern,
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
      projected_trust_gain_score: num(upgrade?.projected_trust_gain_score),
      projected_production_state: text(upgrade?.projected_production_state),
      unlocked_output: text(upgrade?.unlocked_output),
    };
  }).sort((a, b) =>
    policyModeScore(b.segment_priority_mode) - policyModeScore(a.segment_priority_mode)
    || b.segment_priority_score - a.segment_priority_score
    || Number(b.segment_ready_for_generation) - Number(a.segment_ready_for_generation)
    || b.projected_trust_gain_score - a.projected_trust_gain_score
    || a.label.localeCompare(b.label),
  )[0] || null;
}

export function buildReelsBrainHypothesisBank(
  patterns: ReelsBrainDecisionPattern[],
  limit = 8,
  options?: {
    segmentPriorityQueue?: SegmentPriorityRow[];
    generationPolicy?: {
      by_segment?: SegmentPolicyRow[];
    } | null;
  },
) {
  const segmentPriorityMap = new Map((options?.segmentPriorityQueue || []).map((row) => [`${text(row.niche)}__${text(row.platform)}`, row]));
  const segmentPolicyMap = new Map((((options?.generationPolicy?.by_segment) || []) as SegmentPolicyRow[]).map((row) => [`${text(row.niche)}__${text(row.platform)}`, row]));
  const cards = sortHypothesisCards(patterns
    .map((pattern, index) => {
      const decision = normalizeDecision(pattern.final_decision);
      const marketStatus = normalizeMarketStatus(pattern.market_signal?.status);
      const confidence = normalizeConfidence(pattern.market_signal?.confidence || pattern.confidence);
      const priority = segmentSignal(pattern, segmentPriorityMap, segmentPolicyMap);
      return {
        id: text(pattern.id, `hypothesis_${index + 1}`),
        title: text(pattern.title, `Pattern ${index + 1}`),
        platform_focus: list(pattern.platforms, 3),
        niche_focus: list(pattern.niches, 3),
        decision,
        market_status: marketStatus,
        confidence,
        priority_score: priorityScore(pattern),
        segment_priority_score: priority?.segment_priority_score || 0,
        segment_priority_mode: priority?.segment_priority_mode || "research_only",
        segment_priority_label: priority?.label || "",
        segment_ready_for_generation: priority?.segment_ready_for_generation || false,
        projected_trust_gain_score: priority?.projected_trust_gain_score || 0,
        projected_production_state: priority?.projected_production_state || "",
        unlocked_output: priority?.unlocked_output || "",
        hypothesis: hypothesisText(pattern),
        why_now: whyNow(pattern),
        test_plan: testPlan(pattern),
        success_metric: successMetric(pattern),
        guardrails: guardrails(pattern),
        brief_seed: briefSeed(pattern),
      } satisfies ReelsBrainHypothesisCard;
    }))
    .slice(0, limit);

  return {
    cards,
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
      by_platform: ["tiktok", "instagram", "youtube"].map((platform) => ({
        platform,
        count: cards.filter((card) => card.platform_focus.includes(platform)).length,
      })),
    },
  };
}

export function buildGroupedReelsBrainHypothesisBanks(input: {
  patterns: ReelsBrainDecisionPattern[];
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
  const sortGroups = <T extends { cards?: Array<{ segment_priority_mode?: string; segment_priority_score?: number; priority_score?: number; decision?: string; title?: string }> }>(rows: T[]) =>
    rows.sort((a, b) => {
      const aPrimary = a.cards?.[0];
      const bPrimary = b.cards?.[0];
      return policyModeScore(bPrimary?.segment_priority_mode) - policyModeScore(aPrimary?.segment_priority_mode)
        || num(bPrimary?.segment_priority_score) - num(aPrimary?.segment_priority_score)
        || num(bPrimary?.priority_score) - num(aPrimary?.priority_score)
        || text(aPrimary?.decision).localeCompare(text(bPrimary?.decision))
        || text(aPrimary?.title).localeCompare(text(bPrimary?.title));
    });
  return {
    by_niche: sortGroups(niches.map((niche) => ({
      niche,
      ...buildReelsBrainHypothesisBank(
        patterns.filter((pattern) => list(pattern.niches, 20).includes(niche)),
        input.limit || 3,
        options,
      ),
    })).filter((row) => row.cards.length)),
    by_platform: sortGroups(platforms.map((platform) => ({
      platform,
      ...buildReelsBrainHypothesisBank(
        patterns.filter((pattern) => list(pattern.platforms, 20).includes(platform)),
        input.limit || 3,
        options,
      ),
    })).filter((row) => row.cards.length)),
    by_segment: sortGroups(segmentPairs(patterns).map(({ niche, platform }) => ({
      niche,
      platform,
      ...buildReelsBrainHypothesisBank(
        patterns.filter((pattern) =>
          list(pattern.niches, 20).includes(niche) && list(pattern.platforms, 20).includes(platform)),
        input.limit || 3,
        options,
      ),
    })).filter((row) => row.cards.length)),
  };
}
