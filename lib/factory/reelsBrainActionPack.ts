export type ReelsBrainActionPattern = {
  id?: string;
  title?: string;
  hook?: string;
  format?: string;
  retention?: string;
  op_score?: number;
  confidence?: "high" | "medium" | "low" | string;
  quality_gate?: string;
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

export type ReelsBrainActionCard = {
  rank: number;
  pattern_id: string;
  title: string;
  decision: "scale" | "control" | "watch";
  market_status: "proven" | "promising" | "weak" | "no_feedback";
  confidence: "high" | "medium" | "low";
  priority_score: number;
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

function whyNow(pattern: ReelsBrainActionPattern): string[] {
  const reasons = [
    `OP ${num(pattern.op_score)} · gate ${text(pattern.quality_gate, "unknown")}.`,
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

export function buildReelsBrainActionPack(patterns: ReelsBrainActionPattern[], limit = 4) {
  const cards = [...patterns]
    .sort((a, b) =>
      priorityScore(b) - priorityScore(a)
      || num(b.op_score) - num(a.op_score)
      || text(a.title).localeCompare(text(b.title)))
    .slice(0, Math.max(1, limit))
    .map((pattern, index) => ({
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
    } satisfies ReelsBrainActionCard));

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
      rollout_order: cards.map((card) => ({
        rank: card.rank,
        pattern_id: card.pattern_id,
        priority_score: card.priority_score,
        decision: card.decision,
      })),
    },
  };
}

export function buildGroupedReelsBrainActionPacks(input: {
  patterns: ReelsBrainActionPattern[];
  niches?: string[];
  platforms?: string[];
  limit?: number;
}) {
  const patterns = input.patterns || [];
  const niches = Array.from(new Set((input.niches || patterns.flatMap((pattern) => list(pattern.niches, 20))).filter(Boolean))).sort();
  const platforms = Array.from(new Set((input.platforms || patterns.flatMap((pattern) => list(pattern.platforms, 20))).filter(Boolean))).sort();
  return {
    by_niche: niches.map((niche) => ({
      niche,
      ...buildReelsBrainActionPack(
        patterns.filter((pattern) => list(pattern.niches, 20).includes(niche)),
        input.limit || 3,
      ),
    })).filter((row) => row.primary),
    by_platform: platforms.map((platform) => ({
      platform,
      ...buildReelsBrainActionPack(
        patterns.filter((pattern) => list(pattern.platforms, 20).includes(platform)),
        input.limit || 3,
      ),
    })).filter((row) => row.primary),
  };
}
