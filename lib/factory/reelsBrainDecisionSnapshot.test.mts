import test from "node:test";
import assert from "node:assert/strict";
import { buildReelsBrainDecisionSnapshot } from "./reelsBrainDecisionSnapshot";

test("buildReelsBrainDecisionSnapshot merges readiness audit into export items", () => {
  const snapshot = buildReelsBrainDecisionSnapshot({
    creativeExports: {
      summary: { total: 2 },
      ship_now: [
        { lane: "ship", niche: "ru_toys", platform: "instagram", score: 91, high_trust_generation_ready: true, publishable_exact: true },
      ],
      validate_next: [
        { lane: "validate", niche: "ru_cosmetics", platform: "tiktok", score: 77 },
      ],
      research_queue: [],
      items: [
        { lane: "ship", niche: "ru_toys", platform: "instagram", score: 91, high_trust_generation_ready: true, publishable_exact: true },
        { lane: "validate", niche: "ru_cosmetics", platform: "tiktok", score: 77 },
      ],
    },
    readinessAudit: {
      summary: { ready: 1, validate: 1 },
      items: [
        { niche: "ru_toys", platform: "instagram", verdict: "ship", trust: 0.92 },
        { niche: "ru_cosmetics", platform: "tiktok", verdict: "validate", trust: 0.68 },
      ],
    },
    segmentSolutionMatrix: {
      by_segment: [
        {
          niche: "ru_toys",
          platform: "instagram",
          upgrade_forecast: {
            unlocked_output: "publishable_exact_brief",
            projected_trust_gain_score: 28,
          },
        },
      ],
      by_platform: [
        {
          platform: "tiktok",
          next_upgrade: {
            unlocked_output: "performance_tuned_brief",
            projected_trust_gain_score: 19,
          },
        },
      ],
    },
  });

  assert.equal(snapshot.summary.filtered_total, 2);
  assert.equal(snapshot.summary.upgrade_forecast_segments, 2);
  assert.equal(snapshot.summary.generation_ready_segments, 1);
  assert.equal(snapshot.summary.publishable_exact_segments, 1);
  assert.equal(snapshot.items.length, 2);
  assert.deepEqual(snapshot.items[0]?.audit, {
    niche: "ru_toys",
    platform: "instagram",
    verdict: "ship",
    trust: 0.92,
  });
  assert.deepEqual(snapshot.validate_next[0]?.audit, {
    niche: "ru_cosmetics",
    platform: "tiktok",
    verdict: "validate",
    trust: 0.68,
  });
  assert.equal((snapshot.items[0]?.upgrade_forecast as Record<string, unknown> | undefined)?.unlocked_output, "publishable_exact_brief");
  assert.equal((snapshot.items[1]?.upgrade_forecast as Record<string, unknown> | undefined)?.unlocked_output, "performance_tuned_brief");
});

test("buildReelsBrainDecisionSnapshot prioritizes high-trust generation-ready items", () => {
  const snapshot = buildReelsBrainDecisionSnapshot({
    creativeExports: {
      items: [
        {
          lane: "ship",
          niche: "ru_clothing",
          platform: "instagram",
          readiness_score: 98,
          segment_priority_score: 88,
        },
        {
          lane: "ship",
          niche: "ru_toys",
          platform: "tiktok",
          readiness_score: 72,
          segment_priority_score: 31,
          high_trust_generation_ready: true,
          publishable_exact: true,
        },
      ],
    },
  });

  assert.equal(snapshot.items[0]?.niche, "ru_toys");
  assert.equal(snapshot.items[0]?.high_trust_generation_ready, true);
});

test("buildReelsBrainDecisionSnapshot respects lane filter", () => {
  const snapshot = buildReelsBrainDecisionSnapshot({
    creativeExports: {
      ship_now: [
        { lane: "ship", niche: "ru_toys", platform: "instagram" },
      ],
      validate_next: [
        { lane: "validate", niche: "ru_toys", platform: "instagram" },
      ],
      research_queue: [
        { lane: "research", niche: "ru_clothing", platform: "youtube" },
      ],
      items: [
        { lane: "ship", niche: "ru_toys", platform: "instagram" },
        { lane: "validate", niche: "ru_toys", platform: "instagram" },
        { lane: "research", niche: "ru_clothing", platform: "youtube" },
      ],
    },
    readinessAudit: {
      items: [
        { niche: "ru_toys", platform: "instagram", verdict: "ship" },
        { niche: "ru_clothing", platform: "youtube", verdict: "research" },
      ],
    },
    lane: "ship",
  });

  assert.equal(snapshot.summary.filtered_total, 1);
  assert.equal(snapshot.items.length, 1);
  assert.equal(snapshot.ship_now.length, 1);
  assert.equal(snapshot.validate_next.length, 0);
  assert.equal(snapshot.research_queue.length, 0);
  assert.equal(snapshot.items[0]?.["lane"], "ship");
});

test("buildReelsBrainDecisionSnapshot preserves export buckets under niche and platform filter", () => {
  const snapshot = buildReelsBrainDecisionSnapshot({
    creativeExports: {
      ship_now: [
        { lane: "ship", niche: "ru_toys", platform: "instagram", idea: "A" },
        { lane: "ship", niche: "ru_toys", platform: "youtube", idea: "B" },
      ],
      validate_next: [
        { lane: "validate", niche: "ru_toys", platform: "instagram", idea: "C" },
      ],
      research_queue: [
        { lane: "research", niche: "ru_cosmetics", platform: "instagram", idea: "D" },
      ],
      items: [
        { lane: "ship", niche: "ru_toys", platform: "instagram", idea: "A" },
        { lane: "ship", niche: "ru_toys", platform: "youtube", idea: "B" },
        { lane: "validate", niche: "ru_toys", platform: "instagram", idea: "C" },
        { lane: "research", niche: "ru_cosmetics", platform: "instagram", idea: "D" },
      ],
    },
    readinessAudit: {
      items: [
        { niche: "ru_toys", platform: "instagram", verdict: "ship" },
        { niche: "ru_toys", platform: "youtube", verdict: "validate" },
        { niche: "ru_cosmetics", platform: "instagram", verdict: "research" },
      ],
    },
    niche: "ru_toys",
    platform: "instagram",
  });

  assert.equal(snapshot.summary.filtered_total, 2);
  assert.deepEqual(
    snapshot.ship_now.map((row) => row["idea"]),
    ["A"],
  );
  assert.deepEqual(
    snapshot.validate_next.map((row) => row["idea"]),
    ["C"],
  );
  assert.deepEqual(snapshot.research_queue, []);
});
