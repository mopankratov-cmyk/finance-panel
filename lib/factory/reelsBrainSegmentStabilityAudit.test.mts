import test from "node:test";
import assert from "node:assert/strict";
import { buildReelsBrainSegmentStabilityAudit } from "./reelsBrainSegmentStabilityAudit";

test("buildReelsBrainSegmentStabilityAudit marks strong segment as stable", () => {
  const result = buildReelsBrainSegmentStabilityAudit({
    decisionSnapshot: {
      items: [
        {
          niche: "ru_toys",
          platform: "instagram",
          lane: "ship",
          readiness_score: 92,
          trust: {
            corpus_score: 86,
            market_score: 71,
            stable_pattern_count: 4,
            evidence_refs: 5,
          },
          brief: {
            title: "Brief",
            hook: "Hook",
            retention: "Retention",
            structure: "Structure",
          },
          hypothesis: {
            title: "Hypothesis",
            text: "Hypothesis text",
            success_metric: "Hold",
          },
          content_solution: {
            action_title: "Decision",
            action_decision: "scale",
            success_metric: "CTR",
          },
          audit: {
            verdict: "ship",
          },
        },
      ],
    },
  });

  assert.equal(result.summary.stable, 1);
  assert.equal(result.items[0]?.high_trust_segment, true);
  assert.equal(result.items[0]?.evidence_band, "stable");
  assert.equal(result.items[0]?.blockers.length, 0);
});

test("buildReelsBrainSegmentStabilityAudit surfaces blockers on weak segment", () => {
  const result = buildReelsBrainSegmentStabilityAudit({
    decisionSnapshot: {
      items: [
        {
          niche: "ru_cosmetics",
          platform: "youtube",
          lane: "research",
          readiness_score: 51,
          trust: {
            corpus_score: 48,
            market_score: 20,
            stable_pattern_count: 1,
            evidence_refs: 1,
          },
          brief: { hook: "Only hook" },
          hypothesis: {},
          content_solution: {},
          audit: { verdict: "research" },
        },
      ],
    },
  });

  assert.equal(result.summary.thin, 1);
  assert.equal(result.items[0]?.high_trust_segment, false);
  assert.ok(result.items[0]?.blockers.includes("trust floor below 85"));
  assert.ok(result.items[0]?.blockers.includes("fewer than 3 stable patterns"));
});
