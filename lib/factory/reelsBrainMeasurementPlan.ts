type JsonRecord = Record<string, unknown>;

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() || fallback : fallback;
}

function num(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function list(value: unknown, limit = 5): string[] {
  return Array.isArray(value)
    ? value.map((item) => text(item)).filter(Boolean).slice(0, limit)
    : [];
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object") as JsonRecord[] : [];
}

function policyRank(value: unknown) {
  const mode = text(value, "research_only");
  if (mode === "primary") return 3;
  if (mode === "control_only") return 2;
  return 1;
}

function scoreCandidate(candidate: JsonRecord, pattern: JsonRecord) {
  const niche = text(candidate.niche);
  const platform = text(candidate.platform);
  const patternNiches = list(pattern.niches, 6);
  const patternPlatforms = list(pattern.platforms, 6);
  const exactNiche = niche && patternNiches.includes(niche) ? 30 : 0;
  const exactPlatform = platform && patternPlatforms.includes(platform) ? 24 : 0;
  return policyRank(candidate.policy_mode) * 20
    + exactNiche
    + exactPlatform
    + num(candidate.readiness_score) * 0.2;
}

function bestCandidateForPattern(
  pattern: JsonRecord,
  bySegment: JsonRecord[],
  policyBySegment: Map<string, JsonRecord>,
) {
  return [...bySegment]
    .filter((candidate) => {
      const niche = text(candidate.niche);
      const platform = text(candidate.platform);
      const patternNiches = list(pattern.niches, 6);
      const patternPlatforms = list(pattern.platforms, 6);
      return (!patternNiches.length || patternNiches.includes(niche))
        && (!patternPlatforms.length || patternPlatforms.includes(platform));
    })
    .sort((a, b) => {
      const policyA = policyBySegment.get(`${text(a.niche)}__${text(a.platform)}`) || {};
      const policyB = policyBySegment.get(`${text(b.niche)}__${text(b.platform)}`) || {};
      return scoreCandidate({ ...b, policy_mode: text(policyB.policy_mode, b.production_state ? "control_only" : "research_only") }, pattern)
        - scoreCandidate({ ...a, policy_mode: text(policyA.policy_mode, a.production_state ? "control_only" : "research_only") }, pattern);
    })[0] || null;
}

export function buildReelsBrainMeasurementPlan(input: {
  outcomeMemory?: {
    pattern_memory?: {
      no_feedback_queue?: JsonRecord[];
      coverage_rate?: number;
      coverage_gaps?: JsonRecord;
    };
  } | null;
  segmentSolutionMatrix?: {
    by_segment?: JsonRecord[];
  } | null;
  generationPolicy?: {
    by_segment?: JsonRecord[];
  } | null;
  limit?: number;
}) {
  const noFeedbackQueue = records(input.outcomeMemory?.pattern_memory?.no_feedback_queue);
  const bySegment = records(input.segmentSolutionMatrix?.by_segment);
  const policyRows = records(input.generationPolicy?.by_segment);
  const policyBySegment = new Map(policyRows.map((row) => [`${text(row.niche)}__${text(row.platform)}`, row] as const));
  const limit = Math.max(3, input.limit || 6);

  const items = noFeedbackQueue
    .map((pattern) => {
      const candidate = bestCandidateForPattern(pattern, bySegment, policyBySegment);
      const policy = candidate ? (policyBySegment.get(`${text(candidate.niche)}__${text(candidate.platform)}`) || {}) : {};
      const brief = candidate?.creative_brief && typeof candidate.creative_brief === "object" ? candidate.creative_brief as JsonRecord : {};
      const decision = candidate?.content_decision && typeof candidate.content_decision === "object" ? candidate.content_decision as JsonRecord : {};
      const niche = text(candidate?.niche) || text(list(pattern.niches, 1)[0], "mixed");
      const platform = text(candidate?.platform) || text(list(pattern.platforms, 1)[0], "mixed");
      const policyMode = text(policy.policy_mode, "research_only");
      return {
        measurement_id: `${text(pattern.pattern_id)}__${niche}__${platform}`,
        pattern_id: text(pattern.pattern_id),
        title: text(pattern.title, text(pattern.pattern_id, "pattern")),
        niche,
        platform,
        policy_mode: policyMode,
        decision_priority_score: num(pattern.decision_priority_score),
        hook_type: text(pattern.hook_type),
        structure_type: text(pattern.structure_type),
        validation_goal: policyMode === "primary"
          ? "Подтвердить, что паттерн выдерживает основной production lane."
          : policyMode === "control_only"
            ? "Проверить паттерн в controlled batch до повышения trust."
            : "Собрать первые market сигналы без blind scale.",
        publish_brief: {
          hook: text(brief.hook, text(pattern.hook_type, "hook")),
          retention: text(brief.retention, "proof"),
          structure: text(brief.structure, text(pattern.structure_type, "structure")),
          next_step: text(decision.next_step, "Собрать 1-3 тестовых публикации и снять market signal."),
        },
        metrics_to_capture: ["views", "watch_rate", "completion_rate", "ctr", "saves", "marketplace_orders"],
        action: `Сделать measurement-run для ${text(pattern.title, text(pattern.pattern_id, "pattern"))} на ${niche} × ${platform}`,
        reason: `${text(pattern.quality_gate, "unknown")} · priority ${num(pattern.decision_priority_score)} · policy ${policyMode}`,
        endpoints: {
          creative_solution: `/api/factory/reels-brain/creative-solution?niche=${encodeURIComponent(niche)}&platform=${encodeURIComponent(platform)}`,
          feedback_writeback: "/api/factory/reels-brain/feedback",
          post_metrics: "/api/factory/post-metrics",
        },
      };
    })
    .slice(0, limit);

  return {
    status: items.length ? "ready" : "waiting_feedback_gaps",
    coverage_rate: num(input.outcomeMemory?.pattern_memory?.coverage_rate),
    total_candidates: noFeedbackQueue.length,
    high_confidence_no_feedback: num((input.outcomeMemory?.pattern_memory?.coverage_gaps as JsonRecord | undefined)?.high_confidence_no_feedback),
    items,
    next_step: items.length
      ? "Брать верх очереди, выпускать measurement-публикации и сразу писать метрики обратно в feedback loop."
      : "Сначала накопить strong patterns without feedback, затем строить measurement queue.",
  };
}
