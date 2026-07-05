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
  const items = records(input.measurementPlan?.items);
  const limit = Math.max(3, input.limit || 6);
  const queue = items.slice(0, limit).map((item, index) => {
    const brief = (item.publish_brief && typeof item.publish_brief === "object") ? item.publish_brief as JsonRecord : {};
    return {
      task_id: text(item.measurement_id, `measurement_${index + 1}`),
      type: text(item.task_type, "validate_pattern_feedback"),
      priority: taskPriority(item.decision_priority_score),
      pattern_id: text(item.pattern_id),
      title: text(item.title, text(item.pattern_id, "pattern")),
      niche: text(item.niche, "mixed"),
      platform: text(item.platform, "mixed"),
      policy_mode: text(item.policy_mode, "research_only"),
      action: text(item.action, "Снять market signal"),
      validation_goal: text(item.validation_goal, "Получить первые market-сигналы."),
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
      ? "Брать верх очереди: сначала prove_exact_segment, затем validate_pattern_feedback, и после публикации писать outcome через feedback/post-metrics."
      : "Сначала собрать measurement plan из strong no-feedback patterns.",
  };
}
