type PatternOutcomeRow = {
  id?: string;
  title?: string;
  quality_gate?: string;
  confidence?: string;
  decision_priority_score?: number;
  hook_type?: string;
  structure_type?: string;
  niches?: string[];
  platforms?: string[];
  market_signal?: {
    status?: string;
    confidence?: string;
    score?: number;
    winners?: number;
    losers?: number;
    total_posts?: number;
    best_platform?: string | null;
    best_segment?: string | null;
  } | null;
  outcome_writeback?: {
    trust_write?: string;
    outcome_status?: string;
    final_decision?: string;
    quality_gate_override?: string | null;
  } | null;
};

function num(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() || fallback : fallback;
}

function score(row: PatternOutcomeRow) {
  const market = row.market_signal || null;
  return num(market?.score) + (num(market?.winners) * 8) - (num(market?.losers) * 6);
}

function compactRow(row: PatternOutcomeRow) {
  const market = row.market_signal || null;
  const writeback = row.outcome_writeback || null;
  return {
    pattern_id: text(row.id),
    title: text(row.title),
    quality_gate: text(row.quality_gate),
    pattern_confidence: text(row.confidence, "low"),
    decision_priority_score: num(row.decision_priority_score),
    hook_type: text(row.hook_type),
    structure_type: text(row.structure_type),
    niches: Array.isArray(row.niches) ? row.niches.map((item) => text(item)).filter(Boolean).slice(0, 4) : [],
    platforms: Array.isArray(row.platforms) ? row.platforms.map((item) => text(item)).filter(Boolean).slice(0, 4) : [],
    market_status: text(market?.status, "no_feedback"),
    confidence: text(market?.confidence, "low"),
    score: num(market?.score),
    winners: num(market?.winners),
    losers: num(market?.losers),
    total_posts: num(market?.total_posts),
    best_platform: text(market?.best_platform) || null,
    best_segment: text(market?.best_segment) || null,
    trust_write: text(writeback?.trust_write, "wait_for_feedback"),
    final_decision: text(writeback?.final_decision, "watch"),
    quality_gate_override: text(writeback?.quality_gate_override) || null,
  };
}

export function buildReelsBrainPatternOutcomeMemory(input: {
  patterns?: PatternOutcomeRow[] | null;
  limit?: number;
}) {
  const rows = Array.isArray(input.patterns) ? input.patterns : [];
  const withFeedback = rows.filter((row) => num(row.market_signal?.total_posts) > 0);
  const proven = withFeedback.filter((row) => text(row.market_signal?.status) === "proven");
  const promising = withFeedback.filter((row) => text(row.market_signal?.status) === "promising");
  const weak = withFeedback.filter((row) => text(row.market_signal?.status) === "weak");
  const limit = Math.max(3, input.limit || 6);

  const stablePatterns = proven
    .filter((row) => num(row.market_signal?.winners) > 0)
    .sort((a, b) => score(b) - score(a) || text(a.title).localeCompare(text(b.title)))
    .slice(0, limit)
    .map(compactRow);

  const promotionQueue = promising
    .filter((row) => {
      const gate = text(row.quality_gate);
      return gate === "high_confidence" || gate === "medium_confidence";
    })
    .sort((a, b) => score(b) - score(a) || text(a.title).localeCompare(text(b.title)))
    .slice(0, limit)
    .map(compactRow);

  const decayingPatterns = weak
    .filter((row) => {
      const gate = text(row.quality_gate);
      return gate === "high_confidence" || gate === "medium_confidence" || num(row.market_signal?.total_posts) >= 2;
    })
    .sort((a, b) => score(a) - score(b) || text(a.title).localeCompare(text(b.title)))
    .slice(0, limit)
    .map(compactRow);

  const attachablePatterns = rows.filter((row) => {
    const gate = text(row.quality_gate);
    return gate === "high_confidence" || gate === "medium_confidence";
  }).length;
  const noFeedbackQueue = rows
    .filter((row) => {
      const gate = text(row.quality_gate);
      const posts = num(row.market_signal?.total_posts);
      return posts === 0 && (gate === "high_confidence" || gate === "medium_confidence");
    })
    .sort((a, b) =>
      num(b.decision_priority_score) - num(a.decision_priority_score)
      || num(b.market_signal?.score) - num(a.market_signal?.score)
      || text(a.title).localeCompare(text(b.title)),
    )
    .slice(0, limit)
    .map(compactRow);

  const coverage = attachablePatterns > 0
    ? Math.round((withFeedback.length / attachablePatterns) * 100)
    : 0;
  const highConfidenceNoFeedback = noFeedbackQueue.filter((row) => row.quality_gate === "high_confidence").length;
  const mediumConfidenceNoFeedback = noFeedbackQueue.filter((row) => row.quality_gate === "medium_confidence").length;

  return {
    status: withFeedback.length >= 12
      ? "learning_live"
      : withFeedback.length > 0
        ? "seeded"
        : "planned",
    rows_live: withFeedback.length,
    attachable_patterns: attachablePatterns,
    coverage_rate: coverage,
    coverage_gaps: {
      high_confidence_no_feedback: highConfidenceNoFeedback,
      medium_confidence_no_feedback: mediumConfidenceNoFeedback,
      total_no_feedback_queue: noFeedbackQueue.length,
    },
    by_status: {
      proven: proven.length,
      promising: promising.length,
      weak: weak.length,
      no_feedback: Math.max(0, rows.length - withFeedback.length),
    },
    stable_patterns: stablePatterns,
    promotion_queue: promotionQueue,
    decaying_patterns: decayingPatterns,
    no_feedback_queue: noFeedbackQueue,
    trust_write_queue: [
      ...stablePatterns.filter((row) => row.trust_write === "promote_pattern_priority"),
      ...promotionQueue.filter((row) => row.trust_write === "keep_validating_pattern"),
      ...decayingPatterns.filter((row) => row.trust_write === "degrade_pattern_priority"),
    ].slice(0, limit),
    next_step: withFeedback.length === 0
      ? "Ждём больше publication feedback, чтобы pattern memory стала статистически полезной."
      : noFeedbackQueue.length > 0
        ? "Самые сильные паттерны без market feedback нужно первыми гнать в measurement loop."
      : decayingPatterns.length > 0
        ? "Пересобирать weak high-confidence паттерны и не пускать их в blind scale."
        : promotionQueue.length > 0
          ? "Докручивать promising паттерны до confirmed winners и повышать trust."
          : "Расширять coverage feedback на новые сильные паттерны.",
  };
}
