import test from "node:test";
import assert from "node:assert/strict";
import { parseBulkExecutionIntent, tuneBulkBudgetByExecutionIntent, tuneBulkLaneByExecutionIntent } from "./reelsBrainBulkExecutionPolicy";

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

test("tuneBulkLaneByExecutionIntent narrows exact-proof collection to one provider and one query", () => {
  const intent = parseBulkExecutionIntent({
    mode: "close_exact_segment_gap",
    task: "bulk",
    focus_segment: "ru_toys × instagram",
    policy_mode: "primary",
    explanation: "exact proof",
  });
  const result = tuneBulkLaneByExecutionIntent({
    intent,
    lane: { niche: "ru_toys", platform: "instagram", progress_pct: 68 },
    queries: ["q1", "q2", "q3"],
    providers: ["apify_instagram", "bright_instagram"],
    preferredProvider: "bright_instagram",
    providersPerLane: 2,
    queryVariantsPerLane: 2,
    limit: 30,
    providerTimeoutMs: 18000,
  });

  assert.equal(result.strategy, "close_exact_segment_gap");
  assert.deepEqual(result.queries, ["q1"]);
  assert.deepEqual(result.providers, ["bright_instagram"]);
  assert.equal(result.limit, 18);
  assert.equal(result.provider_timeout_ms, 14000);
});

console.log("reelsBrainBulkExecutionPolicy: passed");
