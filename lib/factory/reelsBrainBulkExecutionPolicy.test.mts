import test from "node:test";
import assert from "node:assert/strict";
import { parseBulkExecutionIntent, tuneBulkBudgetByExecutionIntent, tuneBulkLaneByExecutionIntent } from "./reelsBrainBulkExecutionPolicy";
import { parseAnalyzeExecutionIntent, tuneAnalyzeLaneByExecutionIntent } from "./reelsBrainAnalyzeCompactionPolicy";

test("tuneBulkLaneByExecutionIntent narrows primary segment collection to one provider and one query", () => {
  const intent = parseBulkExecutionIntent({
    mode: "support_primary_segment",
    task: "bulk",
    focus_segment: "ru_toys × tiktok",
    policy_mode: "primary",
    explanation: "primary support",
  });
  const result = tuneBulkLaneByExecutionIntent({
    intent,
    lane: { niche: "ru_toys", platform: "tiktok", progress_pct: 42 },
    queries: ["q1", "q2"],
    providers: ["virlo", "apify_tiktok"],
    preferredProvider: "apify_tiktok",
    providersPerLane: 2,
    queryVariantsPerLane: 2,
    limit: 30,
    providerTimeoutMs: 18000,
  });

  assert.equal(result.strategy, "support_primary_segment");
  assert.deepEqual(result.queries, ["q1"]);
  assert.deepEqual(result.providers, ["apify_tiktok"]);
  assert.equal(result.limit, 18);
});

test("tuneBulkLaneByExecutionIntent keeps research mode wider", () => {
  const intent = parseBulkExecutionIntent({
    mode: "explore_research_segment",
    task: "bulk",
    focus_segment: "ru_clothing × instagram",
    policy_mode: "research_only",
    explanation: "research",
  });
  const result = tuneBulkLaneByExecutionIntent({
    intent,
    lane: { niche: "ru_clothing", platform: "instagram", progress_pct: 12 },
    queries: ["q1", "q2", "q3"],
    providers: ["apify_instagram", "ensemble_instagram", "bright_instagram"],
    preferredProvider: "apify_instagram",
    providersPerLane: 1,
    queryVariantsPerLane: 1,
    limit: 20,
    providerTimeoutMs: 18000,
  });

  assert.equal(result.strategy, "explore_research_segment");
  assert.equal(result.query_cap, 2);
  assert.equal(result.provider_cap, 2);
  assert.equal(result.limit, 20);
});

test("tuneBulkBudgetByExecutionIntent lowers budget for primary support", () => {
  const intent = parseBulkExecutionIntent({
    mode: "support_primary_segment",
    task: "bulk",
    focus_segment: "ru_cosmetics × youtube",
    policy_mode: "primary",
    explanation: "primary",
  });
  const result = tuneBulkBudgetByExecutionIntent({
    intent,
    maxProviderCalls: 8,
    maxCostUnits: 18,
  });
  assert.deepEqual(result, { max_provider_calls: 2, max_cost_units: 6 });
});

test("tuneBulkBudgetByExecutionIntent squeezes budget harder for high-gain primary support", () => {
  const intent = parseBulkExecutionIntent({
    mode: "support_primary_segment",
    task: "bulk",
    focus_segment: "ru_cosmetics × youtube",
    policy_mode: "primary",
    explanation: "primary",
    projected_trust_gain_score: 34,
    projected_trust_gain_band: "high",
  });
  const result = tuneBulkBudgetByExecutionIntent({
    intent,
    maxProviderCalls: 8,
    maxCostUnits: 18,
  });
  assert.deepEqual(result, { max_provider_calls: 1, max_cost_units: 4 });
});

test("tuneBulkLaneByExecutionIntent narrows exact-proof collection to one provider and one query", () => {
  const intent = parseBulkExecutionIntent({
    mode: "close_exact_segment_gap",
    task: "bulk",
    focus_segment: "ru_toys × instagram",
    policy_mode: "primary",
    explanation: "exact proof",
    preferred_provider: "apify_instagram",
    source_discovery_mode: "close_exact_proof",
  });
  const result = tuneBulkLaneByExecutionIntent({
    intent,
    lane: { niche: "ru_toys", platform: "instagram", progress_pct: 68 },
    queries: ["q1", "q2", "q3"],
    providers: ["apify_instagram", "bright_instagram"],
    preferredProvider: "bright_instagram",
    recommendedProvider: "apify_instagram",
    providersPerLane: 2,
    queryVariantsPerLane: 2,
    limit: 30,
    providerTimeoutMs: 18000,
  });

  assert.equal(result.strategy, "close_exact_segment_gap:close_exact_proof");
  assert.deepEqual(result.queries, ["q1"]);
  assert.deepEqual(result.providers, ["apify_instagram"]);
  assert.equal(result.limit, 18);
  assert.equal(result.provider_timeout_ms, 14000);
});

test("tuneBulkLaneByExecutionIntent narrows high-gain exact-proof collection even further", () => {
  const intent = parseBulkExecutionIntent({
    mode: "close_exact_segment_gap",
    task: "bulk",
    focus_segment: "ru_toys × instagram",
    policy_mode: "primary",
    explanation: "exact proof",
    preferred_provider: "apify_instagram",
    source_discovery_mode: "close_exact_proof",
    projected_trust_gain_score: 32,
    projected_trust_gain_band: "high",
  });
  const result = tuneBulkLaneByExecutionIntent({
    intent,
    lane: { niche: "ru_toys", platform: "instagram", progress_pct: 68 },
    queries: ["q1", "q2", "q3"],
    providers: ["apify_instagram", "bright_instagram"],
    preferredProvider: "bright_instagram",
    recommendedProvider: "apify_instagram",
    providersPerLane: 2,
    queryVariantsPerLane: 2,
    limit: 30,
    providerTimeoutMs: 18000,
  });

  assert.equal(result.strategy, "close_exact_segment_gap:close_exact_proof");
  assert.deepEqual(result.queries, ["q1"]);
  assert.deepEqual(result.providers, ["apify_instagram"]);
  assert.equal(result.limit, 14);
});

test("tuneAnalyzeLaneByExecutionIntent narrows ship-ready completion to one exact-focused lane", () => {
  const intent = parseAnalyzeExecutionIntent({
    mode: "ship_ready_bundle_completion",
    task: "analyze",
    focus_segment: "ru_clothing × instagram",
    policy_mode: "primary",
    explanation: "ship ready",
  });
  const result = tuneAnalyzeLaneByExecutionIntent({
    intent,
    lane: { niche: "ru_clothing", platform: "instagram", unanalyzed: 19 },
    analyzeLimit: 14,
    buildPatterns: false,
  });

  assert.equal(result.strategy, "ship_ready_bundle_completion");
  assert.equal(result.analyze_limit, 8);
  assert.equal(result.build_patterns, true);
  assert.equal(result.taxonomy_limit, 16);
  assert.equal(result.pattern_limit, 240);
  assert.equal(result.focus_platform, "instagram");
});

console.log("reelsBrainBulkExecutionPolicy: passed");
