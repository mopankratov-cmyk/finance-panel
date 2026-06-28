import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAutomationPlan,
  buildCorpusGrowthQueue,
  parseAutomationNiches,
  parseAutomationPlatforms,
  summarizeLoopResult,
} from "./reelsBrainAutomation";

test("parseAutomationNiches trims, dedupes, and falls back", () => {
  assert.deepEqual(parseAutomationNiches(" toys,clothing,toys ,,default "), ["toys", "clothing", "default"]);
  assert.deepEqual(parseAutomationNiches(null, 2), ["toys", "clothing"]);
});

test("parseAutomationPlatforms normalizes aliases", () => {
  assert.deepEqual(parseAutomationPlatforms("reels,yt,instagram"), ["instagram", "youtube"]);
  assert.deepEqual(parseAutomationPlatforms(""), ["tiktok", "instagram", "youtube"]);
});

test("buildAutomationPlan respects rotation and weekly depth", () => {
  const playbook = {
    reels_brain_queries: {
      stats: [
        { platform: "tiktok", query: "niche viral", runs: 2, found: 20, relevant: 9, inserted: 6, score: 42, updated_at: "2026-06-27T00:00:00.000Z" },
        { platform: "tiktok", query: "niche demo", runs: 1, found: 8, relevant: 5, inserted: 3, score: 18, updated_at: "2026-06-26T00:00:00.000Z" },
      ],
      rotation: { tiktok: "niche viral" },
    },
    reels_brain_policy: {
      relearn: {
        tiktok: { bake_off_limit: 22 },
      },
    },
  };

  const plan = buildAutomationPlan({
    mode: "weekly",
    playbook,
    niche: "niche",
    platform: "tiktok",
    current_videos: 120,
  });

  assert.equal(plan.mode, "weekly");
  assert.equal(plan.queries[0], "niche demo");
  assert.equal(plan.query_count, 5);
  assert.equal(plan.bake_off_limit, 32);
  assert.equal(plan.source_limit, 36);
  assert.equal(plan.analyze_limit, 14);
  assert.equal(plan.corpus_target, 4000);
  assert.equal(plan.current_videos, 120);
  assert.equal(plan.progress_pct, 3);
});

test("summarizeLoopResult aggregates loop stats", () => {
  const summary = summarizeLoopResult({
    source_runs: [
      { found: 10, inserted: 4, relevant: 5 },
      { found: 5, inserted: 2, relevant: 3, error: "partial" },
    ],
    analyze: { analyzed: 7 },
    bake_offs: [{}, {}],
    retries: [{}],
  });

  assert.deepEqual(summary, {
    found: 15,
    inserted: 6,
    relevant: 8,
    analyzed: 7,
    bake_offs: 2,
    retries: 1,
    errors: ["partial"],
  });
});

test("buildCorpusGrowthQueue prioritizes weakest lanes", () => {
  const queue = buildCorpusGrowthQueue({
    max_lanes: 2,
    lanes: [
      { niche: "toys", platform: "tiktok", current_videos: 400, corpus_target: 1000, gap: 600, progress_pct: 40 },
      { niche: "toys", platform: "instagram", current_videos: 10, corpus_target: 875, gap: 865, progress_pct: 1.1 },
      { niche: "clothing", platform: "youtube", current_videos: 0, corpus_target: 625, gap: 625, progress_pct: 0 },
    ],
  });

  assert.equal(queue.length, 2);
  assert.equal(queue[0].niche, "clothing");
  assert.equal(queue[0].platform, "youtube");
  assert.equal(queue[1].platform, "instagram");
});
