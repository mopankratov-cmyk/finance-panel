import test from "node:test";
import assert from "node:assert/strict";
import { buildReelsBrainGenerationPolicy } from "./reelsBrainGenerationPolicy";

test("buildReelsBrainGenerationPolicy maps solution matrix into generation modes", () => {
  const result = buildReelsBrainGenerationPolicy({
    segmentSolutionMatrix: {
      summary: {
        total_segments: 3,
        ready_now: 1,
        controlled_test: 1,
        research_only: 1,
        high_trust_segments: 1,
      },
      by_niche: [
        {
          niche: "ru_toys",
          label: "ru_toys",
          coverage_labels: ["instagram", "tiktok"],
          next_gap: { label: "ru_toys × youtube" },
          primary: {
            label: "ru_toys × instagram",
            readiness_score: 90,
            trust_band: "high",
            production_state: "ready_now",
            trust_why: ["stable corpus"],
            trust_summary: { evidence_band: "stable", stability_score: 84, blockers: [] },
            creative_brief: { title: "Reveal brief", hook: "Смотри что внутри", retention: "open loop", structure: "reveal", do_not_copy: ["text"] },
            hypothesis: { title: "Reveal wins", text: "Reveal boosts hold", success_metric: "3s hold" },
            content_decision: { title: "Scale reveal", decision: "scale", success_metric: "3s hold", guardrails: ["no direct copy"] },
          },
        },
      ],
      by_platform: [
        {
          platform: "instagram",
          label: "instagram",
          coverage_labels: ["ru_toys", "ru_cosmetics"],
          next_gap: { label: "ru_cosmetics × instagram" },
          primary: {
            label: "ru_toys × instagram",
            readiness_score: 68,
            trust_band: "medium",
            production_state: "controlled_test",
            trust_why: ["forming signal"],
            trust_summary: { evidence_band: "forming", stability_score: 61, blockers: ["need more winners"] },
            creative_brief: { hook: "Proof first", retention: "context + payoff", structure: "demo" },
            hypothesis: { title: "Demo wins", text: "Need one more validation" },
            content_decision: { title: "Control batch", decision: "validate", guardrails: ["control only"] },
          },
        },
      ],
      by_segment: [
        {
          niche: "ru_toys",
          platform: "instagram",
          label: "ru_toys × instagram",
          readiness_score: 90,
          trust_band: "high",
          production_state: "ready_now",
          trust_summary: { evidence_band: "stable" },
          creative_brief: { hook: "Segment hook" },
          hypothesis: { text: "Segment hypothesis" },
          content_decision: { decision: "scale" },
        },
      ],
    },
  });

  assert.equal(result.summary.primary_niches, 1);
  assert.equal(result.summary.primary_platforms, 0);
  assert.equal(result.global_default?.policy_mode, "primary");
  assert.equal(result.by_niche[0]?.policy_mode, "primary");
  assert.equal(result.by_niche[0]?.brief_hook, "Смотри что внутри");
  assert.equal(result.by_platform[0]?.policy_mode, "control_only");
});
