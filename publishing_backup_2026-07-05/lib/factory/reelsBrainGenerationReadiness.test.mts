import test from "node:test";
import assert from "node:assert/strict";
import { buildReelsBrainGenerationReadiness } from "./reelsBrainGenerationReadiness";

test("buildReelsBrainGenerationReadiness measures high-trust output coverage by segment, niche and platform", () => {
  const result = buildReelsBrainGenerationReadiness({
    segmentSolutionMatrix: {
      by_segment: [
        {
          niche: "ru_toys",
          platform: "youtube",
          label: "ru_toys × youtube",
          publishable_exact: true,
          segment_priority_score: 88,
        },
        {
          niche: "ru_cosmetics",
          platform: "tiktok",
          label: "ru_cosmetics × tiktok",
          publishable_exact: true,
          segment_priority_score: 91,
          upgrade_forecast: {
            projected_trust_gain_score: 27,
            projected_trust_gain_band: "medium",
            projected_production_state: "high_trust_generation_ready",
            unlocked_output: "usable_segment_bundle",
            recommended_loop: "analyze_backlog",
          },
        },
      ],
    },
    segmentReadinessAudit: {
      items: [
        {
          niche: "ru_toys",
          platform: "youtube",
          label: "ru_toys × youtube",
          verdict: "ship",
          readiness_score: 90,
          blockers: [],
        },
        {
          niche: "ru_cosmetics",
          platform: "tiktok",
          label: "ru_cosmetics × tiktok",
          verdict: "validate",
          readiness_score: 68,
          blockers: ["нет exact-segment proof для production-ready запуска", "audio foundation ещё слабый для production-ready запуска"],
        },
      ],
    },
    segmentCreativeExports: {
      items: [
        {
          niche: "ru_toys",
          platform: "youtube",
          label: "ru_toys × youtube",
          lane: "ship",
          publishable_exact: true,
          brief: { hook: "Hook", structure: "Structure" },
          hypothesis: { title: "Hypothesis", text: "Test it" },
          content_solution: { action_decision: "Ship" },
          segment_priority_score: 88,
        },
        {
          niche: "ru_cosmetics",
          platform: "tiktok",
          label: "ru_cosmetics × tiktok",
          lane: "validate",
          publishable_exact: true,
          brief: { hook: "Hook 2", structure: "" },
          hypothesis: { title: "Hypothesis 2", text: "Validate" },
          content_solution: { action_decision: "Validate" },
          segment_priority_score: 91,
          generator_bundle: {
            blocked_reasons: ["нет exact-segment proof для production-ready запуска"],
          },
        },
      ],
    },
    generationPolicy: {
      by_segment: [
        {
          niche: "ru_toys",
          platform: "youtube",
          policy_mode: "primary",
          decision_priority_score: 88,
        },
        {
          niche: "ru_cosmetics",
          platform: "tiktok",
          policy_mode: "control_only",
          decision_priority_score: 91,
        },
      ],
    },
  });

  assert.equal(result.summary.total_segments, 2);
  assert.equal(result.summary.high_trust_generation_ready_segments, 1);
  assert.equal(result.summary.publishable_exact_segments, 2);
  assert.equal(result.summary.hypothesis_ready_segments, 2);
  assert.equal(result.summary.brief_ready_segments, 1);
  assert.equal(result.summary.content_solution_ready_segments, 2);
  assert.equal(result.summary.segment_specific_ready_pct, 50);
  assert.equal(result.summary.niche_specific_ready_pct, 50);
  assert.equal(result.summary.platform_specific_ready_pct, 50);
  assert.equal(result.summary.verdict, "partial_generation_ready");
  assert.equal(result.top_ready_segments[0]?.platform, "youtube");
  assert.equal(result.by_niche[0]?.niche, "ru_toys");
  assert.equal(result.upgrade_needed_segments[0]?.platform, "tiktok");
  assert.equal(result.upgrade_needed_segments[0]?.audio_foundation_status, "weak");
  assert.equal(result.upgrade_needed_segments[0]?.projected_trust_gain_score, 27);
  assert.equal(result.upgrade_needed_segments[0]?.unlocked_output, "usable_segment_bundle");
  assert.ok((result.summary.top_blockers || []).some((item) => item.blocker === "нет exact-segment proof для production-ready запуска"));
  assert.ok((result.summary.top_blockers || []).some((item) => item.blocker === "audio foundation ещё слабый для production-ready запуска"));
});
