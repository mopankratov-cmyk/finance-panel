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

function exactSegmentStatusRank(value: unknown) {
  const status = text(value, "forming_exact_segment");
  if (status === "missing_exact_segment") return 4;
  if (status === "borrowed_brief_only") return 3;
  if (status === "weak_exact_outcome") return 2;
  return 1;
}

function recommendedUpgrade(row: JsonRecord | null | undefined) {
  if (!row) return null;
  return {
    unlocked_output: text(row.unlocked_output),
    projected_production_state: text(row.projected_production_state),
    projected_trust_gain_score: num(row.projected_trust_gain_score),
    projected_trust_gain_band: text(row.projected_trust_gain_band),
    recommended_loop: text(row.recommended_loop),
    unlocked_next_step: text(row.unlocked_next_step),
  };
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
  exactSegmentQueue?: {
    items?: JsonRecord[];
    summary?: JsonRecord;
  } | null;
  limit?: number;
}) {
  const noFeedbackQueue = records(input.outcomeMemory?.pattern_memory?.no_feedback_queue);
  const bySegment = records(input.segmentSolutionMatrix?.by_segment);
  const policyRows = records(input.generationPolicy?.by_segment);
  const policyBySegment = new Map(policyRows.map((row) => [`${text(row.niche)}__${text(row.platform)}`, row] as const));
  const exactQueueRows = records(input.exactSegmentQueue?.items);
  const limit = Math.max(3, input.limit || 6);

  const exactItems = exactQueueRows
    .sort((a, b) =>
      exactSegmentStatusRank(b.status) - exactSegmentStatusRank(a.status)
      || num(b.urgency_score) - num(a.urgency_score)
      || text(a.label).localeCompare(text(b.label)),
    )
    .map((segment) => {
      const niche = text(segment.niche, "mixed");
      const platform = text(segment.platform, "mixed");
      const exactRow = bySegment.find((row) => text(row.niche) === niche && text(row.platform) === platform) || {};
      const policy = policyBySegment.get(`${niche}__${platform}`) || {};
      const brief = exactRow?.creative_brief && typeof exactRow.creative_brief === "object" ? exactRow.creative_brief as JsonRecord : {};
      const decision = exactRow?.content_decision && typeof exactRow.content_decision === "object" ? exactRow.content_decision as JsonRecord : {};
      const upgrade = recommendedUpgrade(
        (exactRow?.recommended_upgrade && typeof exactRow.recommended_upgrade === "object"
          ? exactRow.recommended_upgrade
          : exactRow?.upgrade_forecast && typeof exactRow.upgrade_forecast === "object"
            ? exactRow.upgrade_forecast
            : null) as JsonRecord | null,
      );
      const status = text(segment.status, "forming_exact_segment");
      const transferSupport = records(segment.transfer_support).slice(0, 2).map((row) => text(row.label)).filter(Boolean);
      return {
        measurement_id: `exact__${niche}__${platform}`,
        task_type: "prove_exact_segment",
        pattern_id: "",
        title: text(segment.label, `${niche} × ${platform}`),
        niche,
        platform,
        policy_mode: text(policy.policy_mode, text(segment.policy_mode, "research_only")),
        decision_priority_score: Math.max(60, num(segment.urgency_score)),
        hook_type: "",
        structure_type: "",
        validation_goal: status === "borrowed_brief_only"
          ? "Подтвердить, что exact segment работает сам, а не только через transfer-соседа."
          : status === "missing_exact_segment"
            ? "Собрать первый exact proof по сегменту и перестать жить на blind transfer."
            : status === "weak_exact_outcome"
              ? "Пересобрать механику и вернуть positive outcome именно на exact segment."
              : "Дотянуть exact segment до market-confirmed состояния.",
        publish_brief: {
          hook: text(brief.hook, "Собрать exact hook под сегмент"),
          retention: text(brief.retention, "proof first"),
          structure: text(brief.structure, "demo"),
          next_step: text(decision.next_step, transferSupport.length
            ? `Снять 1-3 exact публикации и сравнить с transfer-сигналом: ${transferSupport.join(" / ")}.`
            : "Снять 1-3 exact публикации и снять первые market сигналы."),
        },
        recommended_upgrade: upgrade,
        metrics_to_capture: ["views", "watch_rate", "completion_rate", "ctr", "saves", "marketplace_orders"],
        action: `Сделать exact-proof run для ${niche} × ${platform}`,
        reason: `${status} · urgency ${num(segment.urgency_score)} · policy ${text(policy.policy_mode, text(segment.policy_mode, "research_only"))}${upgrade?.unlocked_output ? ` · upgrade ${upgrade.unlocked_output}` : ""}`,
        endpoints: {
          creative_solution: `/api/factory/reels-brain/creative-solution?niche=${encodeURIComponent(niche)}&platform=${encodeURIComponent(platform)}`,
          feedback_writeback: "/api/factory/reels-brain/feedback",
          post_metrics: "/api/factory/post-metrics",
        },
        proof_scope: "exact_segment",
        transfer_support: transferSupport,
      };
    });

  const patternItems = noFeedbackQueue
    .map((pattern) => {
      const candidate = bestCandidateForPattern(pattern, bySegment, policyBySegment);
      const policy = candidate ? (policyBySegment.get(`${text(candidate.niche)}__${text(candidate.platform)}`) || {}) : {};
      const brief = candidate?.creative_brief && typeof candidate.creative_brief === "object" ? candidate.creative_brief as JsonRecord : {};
      const decision = candidate?.content_decision && typeof candidate.content_decision === "object" ? candidate.content_decision as JsonRecord : {};
      const upgrade = recommendedUpgrade(
        (candidate?.recommended_upgrade && typeof candidate.recommended_upgrade === "object"
          ? candidate.recommended_upgrade
          : candidate?.upgrade_forecast && typeof candidate.upgrade_forecast === "object"
            ? candidate.upgrade_forecast
            : null) as JsonRecord | null,
      );
      const niche = text(candidate?.niche) || text(list(pattern.niches, 1)[0], "mixed");
      const platform = text(candidate?.platform) || text(list(pattern.platforms, 1)[0], "mixed");
      const policyMode = text(policy.policy_mode, "research_only");
      return {
        measurement_id: `${text(pattern.pattern_id)}__${niche}__${platform}`,
        task_type: "validate_pattern_feedback",
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
        recommended_upgrade: upgrade,
        metrics_to_capture: ["views", "watch_rate", "completion_rate", "ctr", "saves", "marketplace_orders"],
        action: `Сделать measurement-run для ${text(pattern.title, text(pattern.pattern_id, "pattern"))} на ${niche} × ${platform}`,
        reason: `${text(pattern.quality_gate, "unknown")} · priority ${num(pattern.decision_priority_score)} · policy ${policyMode}${upgrade?.unlocked_output ? ` · upgrade ${upgrade.unlocked_output}` : ""}`,
        endpoints: {
          creative_solution: `/api/factory/reels-brain/creative-solution?niche=${encodeURIComponent(niche)}&platform=${encodeURIComponent(platform)}`,
          feedback_writeback: "/api/factory/reels-brain/feedback",
          post_metrics: "/api/factory/post-metrics",
        },
      };
    });

  const items = [...exactItems, ...patternItems]
    .slice(0, limit);

  return {
    status: items.length ? "ready" : "waiting_feedback_gaps",
    coverage_rate: num(input.outcomeMemory?.pattern_memory?.coverage_rate),
    total_candidates: noFeedbackQueue.length,
    high_confidence_no_feedback: num((input.outcomeMemory?.pattern_memory?.coverage_gaps as JsonRecord | undefined)?.high_confidence_no_feedback),
    exact_gap_candidates: exactQueueRows.length,
    items,
    next_step: items.length
      ? "Брать верх очереди: сначала закрывать exact-proof gaps, затем добивать pattern feedback и сразу писать метрики обратно в feedback loop."
      : "Сначала накопить strong patterns without feedback, затем строить measurement queue.",
  };
}
