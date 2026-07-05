type JsonRecord = Record<string, unknown>;

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() || fallback : fallback;
}

function num(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object") as JsonRecord[] : [];
}

function taskPriority(value: unknown) {
  const score = num(value);
  if (score >= 85) return "high";
  if (score >= 60) return "medium";
  return "low";
}

function proofScopeRank(value: unknown) {
  return text(value) === "exact_segment" ? 2 : 1;
}

function generationReadyRank(value: unknown) {
  return Boolean(value) ? 1 : 0;
}

function recommendedUpgrade(value: unknown) {
  const row = value && typeof value === "object" ? value as JsonRecord : {};
  return {
    unlocked_output: text(row.unlocked_output),
    projected_production_state: text(row.projected_production_state),
    projected_trust_gain_score: num(row.projected_trust_gain_score),
    projected_trust_gain_band: text(row.projected_trust_gain_band),
    recommended_loop: text(row.recommended_loop),
    unlocked_next_step: text(row.unlocked_next_step),
  };
}

export function buildReelsBrainValidationQueue(input: {
  measurementPlan?: {
    items?: JsonRecord[];
    coverage_rate?: number;
    high_confidence_no_feedback?: number;
    total_candidates?: number;
    exact_gap_candidates?: number;
  } | null;
  limit?: number;
}) {
  const items = records(input.measurementPlan?.items)
    .sort((a, b) =>
      proofScopeRank(b.proof_scope) - proofScopeRank(a.proof_scope)
      || generationReadyRank(b.high_trust_generation_ready) - generationReadyRank(a.high_trust_generation_ready)
      || num(b.segment_priority_score) - num(a.segment_priority_score)
      || num(((b.recommended_upgrade as JsonRecord | null)?.projected_trust_gain_score)) - num(((a.recommended_upgrade as JsonRecord | null)?.projected_trust_gain_score))
      || num(b.decision_priority_score) - num(a.decision_priority_score)
      || text(a.title).localeCompare(text(b.title)),
    );
  const limit = Math.max(3, input.limit || 6);
  const queue = items.slice(0, limit).map((item, index) => {
    const brief = (item.publish_brief && typeof item.publish_brief === "object") ? item.publish_brief as JsonRecord : {};
    const upgrade = recommendedUpgrade(item.recommended_upgrade);
    return {
      task_id: text(item.measurement_id, `measurement_${index + 1}`),
      type: text(item.task_type, "validate_pattern_feedback"),
      priority: taskPriority(item.decision_priority_score),
      pattern_id: text(item.pattern_id),
      title: text(item.title, text(item.pattern_id, "pattern")),
      niche: text(item.niche, "mixed"),
      platform: text(item.platform, "mixed"),
      policy_mode: text(item.policy_mode, "research_only"),
      high_trust_generation_ready: Boolean(item.high_trust_generation_ready),
      segment_priority_score: num(item.segment_priority_score),
      segment_priority_reason: text(item.segment_priority_reason),
      action: text(item.action, "Снять market signal"),
      validation_goal: text(item.validation_goal, "Получить первые market-сигналы."),
      recommended_upgrade: upgrade,
      publish_brief: {
        hook: text(brief.hook, "hook"),
        retention: text(brief.retention, "retention"),
        structure: text(brief.structure, "structure"),
        next_step: text(brief.next_step, "Опубликовать и записать метрики."),
      },
      metrics_to_capture: Array.isArray(item.metrics_to_capture) ? item.metrics_to_capture.slice(0, 6) : [],
      writeback_targets: {
        feedback: text((item.endpoints as JsonRecord | undefined)?.feedback_writeback, "/api/factory/reels-brain/feedback"),
        post_metrics: text((item.endpoints as JsonRecord | undefined)?.post_metrics, "/api/factory/post-metrics"),
      },
      task_payload: {
        recipe_id: null,
        pattern_id: text(item.pattern_id),
        niche: text(item.niche, "mixed"),
        platform: text(item.platform, "mixed"),
        target_platform: text(item.platform, "mixed"),
        validation_goal: text(item.validation_goal),
        proof_scope: text(item.proof_scope),
        high_trust_generation_ready: Boolean(item.high_trust_generation_ready),
      },
    };
  });

  return {
    status: queue.length ? "ready" : "waiting_measurement_plan",
    coverage_rate: num(input.measurementPlan?.coverage_rate),
    total_candidates: num(input.measurementPlan?.total_candidates),
    high_confidence_no_feedback: num(input.measurementPlan?.high_confidence_no_feedback),
    exact_gap_candidates: num(input.measurementPlan?.exact_gap_candidates),
    queue,
    next_step: queue.length
      ? "Брать верх очереди: сначала prove_exact_segment, затем generation-ready validation задачи, затем validate_pattern_feedback, и после публикации писать outcome через feedback/post-metrics."
      : "Сначала собрать measurement plan из strong no-feedback patterns.",
  };
}
