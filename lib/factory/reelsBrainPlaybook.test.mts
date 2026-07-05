import {
  assessTrainingReadiness,
  automationRunHistory,
  buildPlatformBrainHint,
  corpusQualityGate,
  incidentHistory,
  incidentSummary,
  nextRecommendedSourceQueries,
  nextRecommendedSourceQuery,
  normalizeTargetPlatform,
  preferredSourceProvider,
  preferredSourceProviders,
  queryLeaderboard,
  recoverableSourceQueries,
  rememberIncident,
  rememberAutomationRun,
  rememberQueryPerformance,
  recommendSourceQueries,
  rememberSourceProvider,
  selectReelsBrain,
  sourceProviderHistory,
  sourceRelearnPolicy,
  suppressedSourceQueries,
} from "./reelsBrainPlaybook";
import { buildReelsBrainBudgetPlan } from "./reelsBrainBudget";

let pass = 0, fail = 0;
function ok(c: boolean, m: string) { if (c) pass++; else { fail++; console.error("✗", m); } }
function eq(a: unknown, b: unknown, m: string) { ok(JSON.stringify(a) === JSON.stringify(b), `${m} (got ${JSON.stringify(a)})`); }

{
  eq(normalizeTargetPlatform("Tiktok"), "tiktok", "normalize: tiktok");
  eq(normalizeTargetPlatform("Instagram"), "instagram", "normalize: instagram");
  eq(normalizeTargetPlatform("Youtube"), "youtube", "normalize: youtube");
  eq(normalizeTargetPlatform("Shorts"), "youtube", "normalize: shorts -> youtube");
}

{
  const playbook = {
    reels_brain_patterns: {
      rebuild_context: {
        execution_mode: "brief_bundle_completion",
        focus_platform: "tiktok",
        output_ready_biased: true,
      },
      platform_brains: {
        tiktok: { niche: "toys", platform: "tiktok", total_videos: 3, analyzed_videos: 2, patterns: [{ hook_type: "warning", structure_type: "demo", retention_mechanism: "proof_wait", frequency: 2 }], top_hooks: ["Не покупай это"], generated_at: "2026-06-27T00:00:00.000Z" },
      },
      meta_brain: { niche: "toys", platform: "all", total_videos: 5, analyzed_videos: 4, patterns: [{ hook_type: "question", structure_type: "review", retention_mechanism: "open_loop", frequency: 1 }], top_hooks: ["Почему это вирусится"], generated_at: "2026-06-27T00:00:00.000Z" },
      cross_platform_patterns: [
        { pattern_id: "p1", hook_type: "warning", structure_type: "demo", retention_mechanism: "proof_wait", emotion: "fear", viral_logic: "x", platforms: ["instagram", "tiktok"], platform_count: 2, total_frequency: 4, avg_strength_score: 22.1 },
      ],
    },
  };

  const selected = selectReelsBrain(playbook, "Tiktok");
  eq(selected.requested_platform, "tiktok", "select: target platform");
  eq(selected.brain?.platform, "tiktok", "select: exact platform brain");
  eq(selected.rebuild_context?.execution_mode, "brief_bundle_completion", "select: rebuild context preserved");
  ok(buildPlatformBrainHint(playbook, "Tiktok").includes("PLATFORM BRAIN (TIKTOK)"), "hint: platform header");
}

{
  const playbook = {
    reels_brain_patterns: {
      meta_brain: { niche: "toys", platform: "all", total_videos: 5, analyzed_videos: 4, patterns: [], top_hooks: ["Meta hook"], generated_at: "2026-06-27T00:00:00.000Z" },
    },
  };
  const selected = selectReelsBrain(playbook, "Instagram");
  eq(selected.brain?.platform, "all", "select: fallback to meta brain");
}

{
  const remembered = rememberSourceProvider({}, "Instagram", {
    provider: "apify_instagram",
    source: "source-run",
    runs: 3,
    valid: 12,
    relevant: 10,
    avg_score: 14.2,
  });
  eq(preferredSourceProvider(remembered, "instagram"), "apify_instagram", "source-memory: remembers provider per platform");
  eq(preferredSourceProvider(remembered, "tiktok"), null, "source-memory: other platform stays empty");
  eq(preferredSourceProviders(remembered).instagram?.provider, "apify_instagram", "source-memory: provider map exposed");
  eq(sourceProviderHistory(remembered, "instagram")[0]?.provider, "apify_instagram", "source-memory: history appended");
}

{
  const playbook = {
    reels_brain_policy: {
      relearn: {
        tiktok: { min_found: 9, min_relevant: 4 },
      },
      quality_gates: {
        youtube: { min_videos: 99, min_analyzed: 33, min_patterns: 8, min_winners: 3 },
      },
    },
  };
  eq(sourceRelearnPolicy(playbook, "tiktok").min_found, 9, "policy: custom relearn min_found");
  eq(corpusQualityGate(playbook, "youtube").min_videos, 99, "policy: custom quality gate");
}

{
  const playbook = {
    hooks: ["Не покупай это", "До и после"],
    winner_hooks: [{ text: "3 ошибки перед покупкой" }],
    winning_formats: [{ name: "demo test" }],
    top_formats: ["before after routine"],
  };
  const queries = recommendSourceQueries(playbook, "water gun", "tiktok");
  ok(queries.includes("water gun review"), "queries: includes platform default");
  ok(queries.some((query) => query.includes("Не покупай это")), "queries: includes hook-derived query");
  ok(queries.some((query) => query.includes("3 ошибки перед покупкой")), "queries: includes winner-derived query");
  ok(queries.some((query) => query.includes("before after routine")), "queries: includes top-format-derived query");
}

{
  const readiness = assessTrainingReadiness({}, "instagram", {
    videos: 40,
    analyzed: 14,
    patterns: 5,
    winners: 2,
  });
  eq(readiness.ready, true, "readiness: enough corpus marks ready");
  ok(readiness.score >= 100, "readiness: score maxed when all gates pass");
}

{
  let playbook = rememberQueryPerformance({}, {
    query: "water gun review",
    platform: "tiktok",
    found: 10,
    relevant: 6,
    inserted: 4,
  });
  playbook = rememberQueryPerformance(playbook, {
    query: "water gun demo",
    platform: "tiktok",
    found: 8,
    relevant: 2,
    inserted: 1,
  });
  eq(queryLeaderboard(playbook, "tiktok")[0]?.query, "water gun review", "queries: leaderboard sorts by score");
  eq(nextRecommendedSourceQuery(playbook, "water gun", "tiktok"), "water gun review", "queries: next recommended prefers proven query");
  eq(nextRecommendedSourceQueries(playbook, "water gun", "tiktok")[0], "water gun review", "queries: rotation avoids repeating the last used query first");
}

{
  eq(nextRecommendedSourceQueries({}, "clothing", "instagram")[0], "fashion haul", "queries: instagram clothing starts from hashtag-friendly fashion seed");
  eq(nextRecommendedSourceQueries({}, "cosmetics", "instagram")[0], "makeup tutorial", "queries: instagram cosmetics starts from hashtag-friendly beauty seed");
  eq(nextRecommendedSourceQueries({}, "toys", "instagram")[0], "toy review", "queries: instagram toys starts from product-review seed");
  eq(nextRecommendedSourceQueries({}, "ru_toys", "instagram")[0], "обзор игрушек", "queries: ru instagram toys starts from Russian seed");
  eq(nextRecommendedSourceQueries({}, "ru_cosmetics", "instagram")[0], "обзор косметики", "queries: ru instagram cosmetics starts from Russian seed");
  eq(nextRecommendedSourceQueries({}, "ru_clothing", "instagram")[0], "обзор одежды", "queries: ru instagram clothing starts from Russian seed");
  eq(nextRecommendedSourceQueries({}, "ru_toys", "tiktok")[0], "обзор игрушек", "queries: ru tiktok toys starts from Russian seed");
  eq(nextRecommendedSourceQueries({}, "ru_cosmetics", "youtube")[0], "обзор косметики shorts", "queries: ru youtube cosmetics starts from Russian shorts seed");
}

{
  let playbook = rememberQueryPerformance({}, {
    query: "water gun dead query",
    platform: "tiktok",
    found: 0,
    relevant: 0,
    inserted: 0,
    empty_result: true,
    suppression_hours: 48,
    updated_at: "2026-12-27T00:00:00.000Z",
  });
  playbook = rememberQueryPerformance(playbook, {
    query: "water gun dead query",
    platform: "tiktok",
    found: 0,
    relevant: 0,
    inserted: 0,
    empty_result: true,
    suppression_hours: 48,
    updated_at: "2026-12-27T01:00:00.000Z",
  });
  playbook = rememberQueryPerformance(playbook, {
    query: "water gun weak query",
    platform: "tiktok",
    found: 4,
    relevant: 1,
    inserted: 0,
    low_yield: true,
    suppression_hours: 24,
    updated_at: "2026-12-27T02:00:00.000Z",
  });
  playbook = rememberQueryPerformance(playbook, {
    query: "water gun weak query",
    platform: "tiktok",
    found: 3,
    relevant: 1,
    inserted: 0,
    low_yield: true,
    suppression_hours: 24,
    updated_at: "2026-12-27T03:00:00.000Z",
  });
  ok(suppressedSourceQueries(playbook, "tiktok").some((row) => row.query === "water gun dead query"), "queries: empty query gets suppressed after repeated empties");
  ok(suppressedSourceQueries(playbook, "tiktok").some((row) => row.query === "water gun weak query"), "queries: repeated weak query gets suppressed");
  ok(!nextRecommendedSourceQueries(playbook, "water gun", "tiktok").includes("water gun dead query"), "queries: suppressed empty query removed from rotation");
  ok(!nextRecommendedSourceQueries(playbook, "water gun", "tiktok").includes("water gun weak query"), "queries: suppressed weak query removed from rotation");
}

{
  let playbook = rememberQueryPerformance({}, {
    query: "provider hiccup query",
    platform: "tiktok",
    found: 0,
    relevant: 0,
    inserted: 0,
    empty_result: true,
    provider_error: true,
    updated_at: "2026-12-27T00:00:00.000Z",
  });
  eq(queryLeaderboard(playbook, "tiktok")[0]?.empty_runs, 0, "queries: provider error does not increment empty_runs");
  ok(!suppressedSourceQueries(playbook, "tiktok").some((row) => row.query === "provider hiccup query"), "queries: provider error does not suppress query");
}

{
  let playbook = rememberQueryPerformance({}, {
    query: "duplicate rich query",
    platform: "tiktok",
    found: 20,
    relevant: 0,
    inserted: 0,
    updated_at: "2026-12-27T00:00:00.000Z",
  });
  playbook = rememberQueryPerformance(playbook, {
    query: "duplicate rich query",
    platform: "tiktok",
    found: 12,
    relevant: 0,
    inserted: 0,
    updated_at: "2026-12-27T01:00:00.000Z",
  });
  ok(suppressedSourceQueries(playbook, "tiktok").some((row) => row.query === "duplicate rich query"), "queries: duplicate-only query gets suppressed");
  ok(!nextRecommendedSourceQueries(playbook, "water gun", "tiktok").includes("duplicate rich query"), "queries: duplicate-only query removed from rotation");
}

{
  let playbook = rememberQueryPerformance({}, {
    query: "water gun recovery query",
    platform: "tiktok",
    found: 0,
    relevant: 0,
    inserted: 0,
    empty_result: true,
    suppression_hours: 1,
    updated_at: "2026-06-26T00:00:00.000Z",
  });
  playbook = rememberQueryPerformance(playbook, {
    query: "water gun recovery query",
    platform: "tiktok",
    found: 0,
    relevant: 0,
    inserted: 0,
    empty_result: true,
    suppression_hours: 1,
    updated_at: "2026-06-26T01:00:00.000Z",
  });
  ok(recoverableSourceQueries(playbook, "tiktok").some((row) => row.query === "water gun recovery query"), "queries: expired suppression becomes recoverable");
  eq(nextRecommendedSourceQuery(playbook, "water gun", "tiktok"), "water gun recovery query", "queries: recovery query returns first for soft re-check");
  playbook = rememberQueryPerformance(playbook, {
    query: "water gun recovery query",
    platform: "tiktok",
    found: 9,
    relevant: 5,
    inserted: 3,
    updated_at: "2026-06-27T02:00:00.000Z",
  });
  ok(!suppressedSourceQueries(playbook, "tiktok").some((row) => row.query === "water gun recovery query"), "queries: successful recovery clears suppression");
  ok(!recoverableSourceQueries(playbook, "tiktok").some((row) => row.query === "water gun recovery query"), "queries: successful recovery leaves recovery queue");
}

{
  let playbook = rememberIncident({}, {
    platform: "youtube",
    severity: "critical",
    kind: "empty_intake",
    message: "provider returned zero useful videos",
    provider: "apify_youtube",
  });
  playbook = rememberIncident(playbook, {
    platform: "youtube",
    severity: "critical",
    kind: "empty_intake",
    message: "provider returned zero useful videos",
    provider: "apify_youtube",
  });
  eq(incidentHistory(playbook, "youtube")[0]?.kind, "empty_intake", "incidents: history stores incident");
  eq(incidentHistory(playbook, "youtube").length, 1, "incidents: cooldown prevents duplicate spam");
  eq(incidentSummary(playbook, "youtube").critical, 1, "incidents: summary counts severity");
}

{
  let playbook = rememberAutomationRun({}, {
    mode: "bulk",
    strategy: "bulk_raw_ingest",
    niche: "ru_toys",
    platforms: ["tiktok", "youtube"],
    ok: true,
    found: 30,
    inserted: 12,
    analyzed: 12,
    relevant: 18,
    retries: 1,
    errors: 0,
    best_provider: "apify_tiktok",
    created_at: "2026-06-28T10:00:00.000Z",
  });
  playbook = rememberAutomationRun(playbook, {
    mode: "weekly",
    niche: "ru_toys",
    platforms: ["instagram"],
    ok: false,
    found: 5,
    inserted: 0,
    analyzed: 0,
    relevant: 1,
    retries: 0,
    errors: 1,
    created_at: "2026-06-28T11:00:00.000Z",
  });
  eq(automationRunHistory(playbook)[0]?.mode, "weekly", "automation history: newest run first");
  eq(automationRunHistory(playbook)[1]?.inserted, 12, "automation history: stores inserted count");
}

{
  const plan = buildReelsBrainBudgetPlan(["youtube", "apify_tiktok", "bright_tiktok", "apify_instagram"], {
    max_provider_calls: 3,
    max_cost_units: 7,
  });
  eq(plan.used_provider_calls, 3, "budget: continues after skipping one expensive provider");
  eq(plan.decisions.filter((row) => row.allowed).length, 3, "budget: allows affordable provider calls");
  ok(plan.decisions.some((row) => row.reason === "cost_unit_budget_exceeded"), "budget: records skipped cost reason");
}

console.log(`\nreelsBrainPlaybook: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
