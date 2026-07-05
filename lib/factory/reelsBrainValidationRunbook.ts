type JsonRecord = Record<string, unknown>;

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() || fallback : fallback;
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object") as JsonRecord[] : [];
}

export function buildReelsBrainValidationRunbook(input: {
  validationQueue?: {
    queue?: JsonRecord[];
    status?: string;
    next_step?: string;
    exact_gap_candidates?: number;
  } | null;
  measurementPlan?: {
    items?: JsonRecord[];
  } | null;
  limit?: number;
}) {
  const validationRows = records(input.validationQueue?.queue);
  const measurementRows = records(input.measurementPlan?.items);
  const byMeasurementId = new Map(measurementRows.map((row) => [text(row.measurement_id), row] as const));
  const limit = Math.max(3, input.limit || 6);

  const items = validationRows.slice(0, limit).map((row) => {
    const measurement = byMeasurementId.get(text(row.task_id)) || {};
    const brief = (row.publish_brief && typeof row.publish_brief === "object" ? row.publish_brief : {}) as JsonRecord;
    const endpoints = (measurement.endpoints && typeof measurement.endpoints === "object" ? measurement.endpoints : {}) as JsonRecord;
    const writeback = (row.writeback_targets && typeof row.writeback_targets === "object" ? row.writeback_targets : {}) as JsonRecord;
    const payload = (row.task_payload && typeof row.task_payload === "object" ? row.task_payload : {}) as JsonRecord;
    const upgrade = (measurement.recommended_upgrade && typeof measurement.recommended_upgrade === "object"
      ? measurement.recommended_upgrade
      : row.recommended_upgrade && typeof row.recommended_upgrade === "object"
        ? row.recommended_upgrade
        : {}) as JsonRecord;
    const proofScope = text(payload.proof_scope);
    const highTrustGenerationReady = Boolean(row.high_trust_generation_ready || measurement.high_trust_generation_ready || payload.high_trust_generation_ready);
    return {
      task_id: text(row.task_id),
      task_type: text(row.type, "validate_pattern_feedback"),
      title: text(row.title, text(measurement.title, "validation task")),
      niche: text(row.niche, text(measurement.niche, "mixed")),
      platform: text(row.platform, text(measurement.platform, "mixed")),
      policy_mode: text(row.policy_mode, text(measurement.policy_mode, "research_only")),
      high_trust_generation_ready: highTrustGenerationReady,
      segment_priority_score: Number(row.segment_priority_score || measurement.segment_priority_score || 0),
      segment_priority_reason: text(row.segment_priority_reason, text(measurement.segment_priority_reason, "")),
      priority: text(row.priority, "medium"),
      action: text(row.action, text(measurement.action, "Снять market signal")),
      validation_goal: text(row.validation_goal, text(measurement.validation_goal, "Получить первые market-сигналы.")),
      proof_scope: proofScope || "pattern_feedback",
      recommended_upgrade: {
        unlocked_output: text(upgrade.unlocked_output),
        projected_production_state: text(upgrade.projected_production_state),
        projected_trust_gain_score: Number(upgrade.projected_trust_gain_score || 0),
        projected_trust_gain_band: text(upgrade.projected_trust_gain_band),
        recommended_loop: text(upgrade.recommended_loop),
        unlocked_next_step: text(upgrade.unlocked_next_step),
      },
      publish_brief: {
        hook: text(brief.hook, "hook"),
        retention: text(brief.retention, "retention"),
        structure: text(brief.structure, "structure"),
        next_step: text(brief.next_step, "Опубликовать и записать метрики."),
      },
      creative_solution_endpoint: text(endpoints.creative_solution, `/api/factory/reels-brain/creative-solution?niche=${encodeURIComponent(text(row.niche, "mixed"))}&platform=${encodeURIComponent(text(row.platform, "mixed"))}`),
      feedback_endpoint: text(writeback.feedback, "/api/factory/reels-brain/feedback"),
      post_metrics_endpoint: text(writeback.post_metrics, "/api/factory/post-metrics"),
      publish_checklist: [
        proofScope === "exact_segment"
          ? "Снять exact segment variant, не опираясь на соседний transfer как на финальное доказательство."
          : highTrustGenerationReady
            ? "Снять production-usable variant и проверить, что generation-ready сегмент не теряет high-trust сигнал на публикации."
          : "Снять variant по strongest pattern и не менять ключевую механику.",
        "После публикации сразу записать views и базовые rates.",
        "Если есть publication_id или external_post_id, вернуть их в writeback.",
      ],
      feedback_payload_template: {
        measurement_id: text(row.task_id),
        validation_task_id: text(row.task_id),
        recipe_id: null,
        platform: text(row.platform, "mixed"),
        views: null,
        watch_rate: null,
        hook_rate: null,
        hold_rate: null,
        completion_rate: null,
        ctr: null,
        saves: null,
        marketplace_orders: null,
        revenue: null,
        source: "reels_brain_feedback",
        proof_scope: proofScope || null,
        high_trust_generation_ready: highTrustGenerationReady,
      },
    };
  });

  return {
    status: items.length ? "ready" : "waiting_validation_queue",
    exact_gap_candidates: Number(input.validationQueue?.exact_gap_candidates || 0),
    next_step: items.length
      ? "Брать первый item, получать creative solution, публиковать variant и слать feedback_payload_template обратно."
      : text(input.validationQueue?.next_step, "Сначала собрать validation queue."),
    items,
  };
}
