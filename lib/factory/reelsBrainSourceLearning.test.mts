import { assessSourceRunHealth, chooseRetryProviderPlan, chooseRetryQueryPivot } from "./reelsBrainSourceLearning";

let pass = 0, fail = 0;
function ok(c: boolean, m: string) { if (c) pass++; else { fail++; console.error("✗", m); } }
function eq(a: unknown, b: unknown, m: string) { ok(JSON.stringify(a) === JSON.stringify(b), `${m} (got ${JSON.stringify(a)})`); }

{
  const report = assessSourceRunHealth({
    found: 12,
    relevant: 8,
    inserted: 6,
    remembered_provider: "apify_tiktok",
    learned_provider: "apify_tiktok",
    target_platform: "Tiktok",
  });
  eq(report.should_relearn, false, "health: healthy run does not retrain");
  eq(report.target_platform, "tiktok", "health: platform normalized");
}

{
  const report = assessSourceRunHealth({
    found: 10,
    relevant: 2,
    inserted: 1,
    remembered_provider: "apify_tiktok",
    learned_provider: "virlo",
    target_platform: "tiktok",
    segment_outcome_status: "weak",
  });
  eq(report.should_relearn, true, "health: winner shift forces relearn");
  ok(report.reasons.some((reason) => reason.includes("winner changed")), "health: shift reason present");
  eq(report.segment_outcome_status, "weak", "health: weak outcome is exposed");
}

{
  const report = assessSourceRunHealth({
    found: 0,
    relevant: 0,
    inserted: 0,
    target_platform: "youtube",
  });
  eq(report.empty_result, true, "health: empty result flagged");
  eq(report.should_relearn, true, "health: empty result requests relearn");
}

{
  const plan = chooseRetryProviderPlan({
    remembered_provider: "apify_tiktok",
    learned_provider: "virlo",
  }, {
    should_relearn: true,
    bake_off_provider: "apify_instagram",
  });
  eq(plan.retry_provider, "apify_instagram", "retry-plan: bake-off winner overrides learned provider");
  eq(plan.pin_provider, true, "retry-plan: alternate provider is pinned");
}

{
  const plan = chooseRetryProviderPlan({
    remembered_provider: "apify_tiktok",
    learned_provider: "virlo",
  }, {
    should_relearn: true,
  });
  eq(plan.retry_provider, "virlo", "retry-plan: source-run winner used when bake-off winner absent");
}

{
  const plan = chooseRetryProviderPlan({
    remembered_provider: "apify_tiktok",
    learned_provider: "apify_tiktok",
  }, {
    should_relearn: false,
  });
  eq(plan.retry_provider, null, "retry-plan: healthy run keeps current provider");
}

{
  const pivot = chooseRetryQueryPivot({
    query: "косметика обзор",
    recommended_queries: ["косметика обзор", "до и после косметика", "ugc косметика"],
    segment_outcome_status: "weak",
  }, {
    should_relearn: true,
  });
  eq(pivot.retry_query, "до и после косметика", "retry-query: weak segment pivots to the next recommended query");
}

{
  const pivot = chooseRetryQueryPivot({
    query: "игрушки обзор",
    recommended_queries: ["игрушки обзор", "детские игрушки"],
    segment_outcome_status: "proven",
  }, {
    should_relearn: true,
  });
  eq(pivot.retry_query, null, "retry-query: proven segment keeps current query");
}

console.log(`\nreelsBrainSourceLearning: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
