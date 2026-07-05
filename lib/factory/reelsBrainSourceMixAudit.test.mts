import assert from "node:assert/strict";
import { buildReelsBrainSourceMixAudit } from "./reelsBrainSourceMixAudit";

const result = buildReelsBrainSourceMixAudit({
  segmentSolutions: {
    items: [
      {
        niche: "ru_toys",
        platform: "instagram",
        label: "ru_toys × instagram",
        production_state: "ready_now",
        trust_summary: {
          proof_quality: "exact_segment",
        },
      },
      {
        niche: "ru_clothing",
        platform: "instagram",
        label: "ru_clothing × instagram",
        production_state: "controlled_test",
        trust_summary: {
          proof_quality: "traced_transfer_only",
        },
      },
      {
        niche: "ru_cosmetics",
        platform: "youtube",
        label: "ru_cosmetics × youtube",
        production_state: "research_only",
        trust_summary: {
          proof_quality: "untraced",
        },
      },
    ],
  },
  segmentGenerationPacks: {
    items: [
      {
        niche: "ru_toys",
        platform: "instagram",
        quality_gate: {
          status: "ready",
          exact_segment_ready: true,
        },
      },
      {
        niche: "ru_clothing",
        platform: "instagram",
        quality_gate: {
          status: "needs_validation",
          exact_segment_ready: false,
        },
      },
    ],
  },
  exactSegmentQueue: {
    summary: {
      exact_gap_segments: 2,
    },
  },
  feedbackLoop: {
    validation_trace: {
      traced_posts: 12,
      exact_segment_posts: 5,
    },
  },
});

assert.equal(result.summary.total_segment_solutions, 3);
assert.equal(result.summary.exact_ready_solutions, 1);
assert.equal(result.summary.transfer_only_solutions, 1);
assert.equal(result.summary.untraced_solutions, 1);
assert.equal(result.summary.exact_ready_coverage_pct, 33);
assert.equal(result.summary.validation_traced_posts, 12);
assert.equal(result.summary.validation_exact_posts, 5);
assert.equal(result.summary.legacy_fallback_policy, "guarded");
assert.equal(result.by_platform[0]?.platform, "instagram");

console.log("reelsBrainSourceMixAudit.test: ok");
