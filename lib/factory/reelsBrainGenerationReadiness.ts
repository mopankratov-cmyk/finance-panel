type JsonRecord = Record<string, unknown>;

function num(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() || fallback : fallback;
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object") as JsonRecord[] : [];
}

function pct(part: number, total: number) {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

function policyModeRank(value: unknown) {
  const mode = text(value, "research_only");
  if (mode === "primary") return 3;
  if (mode === "control_only") return 2;
  return 1;
}

function truthyText(...values: unknown[]) {
  for (const value of values) {
    const out = text(value);
    if (out) return out;
  }
  return "";
}

function summarizeDimension(dimension: "niche" | "platform", items: JsonRecord[]) {
  const groups = new Map<string, JsonRecord[]>();
  for (const item of items) {
    const key = text(item[dimension]);
    if (!key) continue;
    const rows = groups.get(key) || [];
    rows.push(item);
    groups.set(key, rows);
  }

  return Array.from(groups.entries())
    .map(([key, rows]) => {
      const highTrustReady = rows.filter((row) => Boolean(row.high_trust_generation_ready)).length;
      const publishableExact = rows.filter((row) => Boolean(row.publishable_exact)).length;
      const briefReady = rows.filter((row) => Boolean(row.brief_ready)).length;
      const contentReady = rows.filter((row) => Boolean(row.content_solution_ready)).length;
      const policyPrimary = rows.filter((row) => text(row.policy_mode) === "primary").length;
      const top = [...rows].sort((a, b) =>
        Number(Boolean(b.high_trust_generation_ready)) - Number(Boolean(a.high_trust_generation_ready))
        || policyModeRank(b.policy_mode) - policyModeRank(a.policy_mode)
        || num(b.segment_priority_score) - num(a.segment_priority_score)
        || num(b.readiness_score) - num(a.readiness_score)
        || text(a.label).localeCompare(text(b.label)),
      )[0] || null;
      return {
        [dimension]: key,
        label: key,
        total_segments: rows.length,
        high_trust_generation_ready_segments: highTrustReady,
        publishable_exact_segments: publishableExact,
        brief_ready_segments: briefReady,
        content_solution_ready_segments: contentReady,
        primary_policy_segments: policyPrimary,
        readiness_pct: pct(highTrustReady, rows.length),
        top_segment: top ? {
          label: text(top.label),
          policy_mode: text(top.policy_mode, "research_only"),
          verdict: text(top.verdict, "research"),
          publishable_exact: Boolean(top.publishable_exact),
          readiness_score: num(top.readiness_score),
        } : null,
      };
    })
    .sort((a, b) =>
      num(b.high_trust_generation_ready_segments) - num(a.high_trust_generation_ready_segments)
      || num(b.publishable_exact_segments) - num(a.publishable_exact_segments)
      || num(b.primary_policy_segments) - num(a.primary_policy_segments)
      || num(b.readiness_pct) - num(a.readiness_pct)
      || text(a.label).localeCompare(text(b.label)),
    );
}

export function buildReelsBrainGenerationReadiness(input: {
  segmentSolutionMatrix?: {
    by_segment?: JsonRecord[];
  } | null;
  segmentReadinessAudit?: {
    items?: JsonRecord[];
  } | null;
  segmentCreativeExports?: {
    items?: JsonRecord[];
  } | null;
  generationPolicy?: {
    by_segment?: JsonRecord[];
  } | null;
  limit?: number;
}) {
  const matrixRows = records(input.segmentSolutionMatrix?.by_segment);
  const readinessRows = records(input.segmentReadinessAudit?.items);
  const exportRows = records(input.segmentCreativeExports?.items);
  const policyRows = records(input.generationPolicy?.by_segment);
  const keys = new Set<string>();

  for (const row of [...matrixRows, ...readinessRows, ...exportRows, ...policyRows]) {
    const niche = text(row.niche);
    const platform = text(row.platform);
    if (!niche || !platform) continue;
    keys.add(`${niche}__${platform}`);
  }

  const matrixMap = new Map<string, JsonRecord>(matrixRows.map((row) => [`${text(row.niche)}__${text(row.platform)}`, row] as const));
  const readinessMap = new Map<string, JsonRecord>(readinessRows.map((row) => [`${text(row.niche)}__${text(row.platform)}`, row] as const));
  const exportMap = new Map<string, JsonRecord>(exportRows.map((row) => [`${text(row.niche)}__${text(row.platform)}`, row] as const));
  const policyMap = new Map<string, JsonRecord>(policyRows.map((row) => [`${text(row.niche)}__${text(row.platform)}`, row] as const));

  const items = Array.from(keys)
    .map((key) => {
      const matrix = (matrixMap.get(key) || {}) as JsonRecord;
      const readiness = (readinessMap.get(key) || {}) as JsonRecord;
      const exp = (exportMap.get(key) || {}) as JsonRecord;
      const policy = (policyMap.get(key) || {}) as JsonRecord;
      const niche = truthyText(matrix.niche, readiness.niche, exp.niche, policy.niche);
      const platform = truthyText(matrix.platform, readiness.platform, exp.platform, policy.platform);
      const verdict = truthyText(readiness.verdict, exp.lane === "ship" ? "ship" : exp.lane === "validate" ? "validate" : "", "research");
      const lane = truthyText(exp.lane, verdict === "ship" ? "ship" : verdict === "validate" ? "validate" : "research");
      const policyMode = truthyText(policy.policy_mode, matrix.segment_priority_mode, readiness.segment_priority_mode, exp.segment_priority_mode, "research_only");
      const publishableExact = Boolean(matrix.publishable_exact || exp.publishable_exact);
      const upgradeForecast = (matrix.upgrade_forecast && typeof matrix.upgrade_forecast === "object")
        ? matrix.upgrade_forecast as JsonRecord
        : {};
      const briefHook = truthyText((exp.brief as JsonRecord | null)?.hook, (exp.generator_bundle as JsonRecord | null)?.payload && ((exp.generator_bundle as JsonRecord).payload as JsonRecord).hook);
      const briefStructure = truthyText((exp.brief as JsonRecord | null)?.structure, (exp.generator_bundle as JsonRecord | null)?.payload && ((exp.generator_bundle as JsonRecord).payload as JsonRecord).structure);
      const hypothesisTitle = truthyText((exp.hypothesis as JsonRecord | null)?.title);
      const hypothesisText = truthyText((exp.hypothesis as JsonRecord | null)?.text);
      const actionDecision = truthyText((exp.content_solution as JsonRecord | null)?.action_decision, (exp.content_solution as JsonRecord | null)?.action_title);
      const blockers = Array.from(new Set([
        ...(Array.isArray(readiness.blockers) ? readiness.blockers.map((item) => text(item)) : []),
        ...(Array.isArray((exp.generator_bundle as JsonRecord | null)?.blocked_reasons)
          ? (((exp.generator_bundle as JsonRecord | null)?.blocked_reasons) as unknown[]).map((item) => text(item))
          : []),
      ].filter(Boolean))).slice(0, 5);
      const hypothesisReady = (verdict === "ship" || verdict === "validate") && Boolean(hypothesisTitle || hypothesisText);
      const briefReady = (verdict === "ship" || verdict === "validate") && Boolean(briefHook && briefStructure);
      const contentSolutionReady = (lane === "ship" || lane === "validate") && Boolean(actionDecision);
      const highTrustGenerationReady = publishableExact && briefReady && contentSolutionReady && policyMode !== "research_only";
      return {
        niche,
        platform,
        label: truthyText(matrix.label, readiness.label, exp.label, `${niche} × ${platform}`),
        policy_mode: policyMode,
        verdict,
        lane,
        segment_priority_score: Math.max(
          num(matrix.segment_priority_score),
          num(readiness.segment_priority_score),
          num(exp.segment_priority_score),
          num(policy.decision_priority_score),
          num(upgradeForecast.projected_trust_gain_score),
        ),
        readiness_score: Math.max(num(matrix.avg_readiness_score), num(readiness.readiness_score), num(exp.readiness_score)),
        publishable_exact: publishableExact,
        hypothesis_ready: hypothesisReady,
        brief_ready: briefReady,
        content_solution_ready: contentSolutionReady,
        high_trust_generation_ready: highTrustGenerationReady,
        recommended_loop: text(upgradeForecast.recommended_loop),
        unlocked_output: text(upgradeForecast.unlocked_output),
        projected_production_state: text(upgradeForecast.projected_production_state),
        projected_trust_gain_score: num(upgradeForecast.projected_trust_gain_score),
        projected_trust_gain_band: text(upgradeForecast.projected_trust_gain_band),
        primary_missing_family: text(upgradeForecast.primary_missing_family),
        next_step: truthyText(upgradeForecast.next_step),
        blockers,
      };
    })
    .sort((a, b) =>
      Number(b.high_trust_generation_ready) - Number(a.high_trust_generation_ready)
      || Number(b.publishable_exact) - Number(a.publishable_exact)
      || policyModeRank(b.policy_mode) - policyModeRank(a.policy_mode)
      || num(b.segment_priority_score) - num(a.segment_priority_score)
      || num(b.readiness_score) - num(a.readiness_score)
      || text(a.label).localeCompare(text(b.label)),
    );

  const blockerCounts = new Map<string, number>();
  for (const item of items.filter((row) => !row.high_trust_generation_ready)) {
    for (const blocker of item.blockers) blockerCounts.set(blocker, (blockerCounts.get(blocker) || 0) + 1);
  }
  const topBlockers = Array.from(blockerCounts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([blocker, segments]) => ({ blocker, segments }));

  const byNiche = summarizeDimension("niche", items);
  const byPlatform = summarizeDimension("platform", items);
  const totalSegments = items.length;
  const highTrustSegments = items.filter((row) => row.high_trust_generation_ready).length;
  const publishableExactSegments = items.filter((row) => row.publishable_exact).length;
  const hypothesisReadySegments = items.filter((row) => row.hypothesis_ready).length;
  const briefReadySegments = items.filter((row) => row.brief_ready).length;
  const contentReadySegments = items.filter((row) => row.content_solution_ready).length;
  const primaryPolicySegments = items.filter((row) => row.policy_mode === "primary").length;
  const nicheSpecificReady = byNiche.filter((row) => num(row.high_trust_generation_ready_segments) > 0).length;
  const platformSpecificReady = byPlatform.filter((row) => num(row.high_trust_generation_ready_segments) > 0).length;
  const segmentSpecificReadyPct = pct(highTrustSegments, totalSegments);
  const nicheSpecificReadyPct = pct(nicheSpecificReady, byNiche.length);
  const platformSpecificReadyPct = pct(platformSpecificReady, byPlatform.length);
  const verdict = segmentSpecificReadyPct >= 65 && nicheSpecificReadyPct >= 80 && platformSpecificReadyPct >= 80
    ? "high_trust_generation_ready"
    : segmentSpecificReadyPct >= 35
      ? "partial_generation_ready"
      : "research_heavy";

  return {
    summary: {
      total_segments: totalSegments,
      high_trust_generation_ready_segments: highTrustSegments,
      publishable_exact_segments: publishableExactSegments,
      hypothesis_ready_segments: hypothesisReadySegments,
      brief_ready_segments: briefReadySegments,
      content_solution_ready_segments: contentReadySegments,
      primary_policy_segments: primaryPolicySegments,
      segment_specific_ready_pct: segmentSpecificReadyPct,
      niche_specific_ready_pct: nicheSpecificReadyPct,
      platform_specific_ready_pct: platformSpecificReadyPct,
      verdict,
      top_blockers: topBlockers,
    },
    top_ready_segments: items.filter((row) => row.high_trust_generation_ready).slice(0, Math.max(3, input.limit || 8)),
    upgrade_needed_segments: items.filter((row) => row.publishable_exact && !row.high_trust_generation_ready).slice(0, Math.max(3, input.limit || 8)),
    research_segments: items.filter((row) => !row.publishable_exact).slice(0, Math.max(3, input.limit || 8)),
    by_niche: byNiche.slice(0, Math.max(3, input.limit || 8)),
    by_platform: byPlatform.slice(0, Math.max(3, input.limit || 8)),
    items: items.slice(0, Math.max(4, input.limit || 8)),
  };
}
