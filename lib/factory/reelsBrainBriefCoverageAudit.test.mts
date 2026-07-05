import assert from "node:assert/strict";
import { buildReelsBrainBriefCoverageAudit } from "./reelsBrainBriefCoverageAudit";

const result = buildReelsBrainBriefCoverageAudit({
  segmentGenerationPacks: {
    items: [
      {
        niche: "ru_toys",
        platform: "tiktok",
        readiness_score: 94,
        proof_quality: "exact_segment",
        quality_gate: { status: "ready", blocked_reasons: [] },
      },
      {
        niche: "ru_cosmetics",
        platform: "instagram",
        readiness_score: 76,
        proof_quality: "traced_transfer_only",
        quality_gate: { status: "needs_validation", blocked_reasons: ["нет exact-segment proof"] },
        next_step: "Collect exact proof",
      },
    ],
  },
  segmentCreativeExports: {
    items: [
      {
        niche: "ru_toys",
        platform: "tiktok",
        label: "ru_toys × tiktok",
        lane: "ship",
        readiness_score: 94,
        brief: {
          title: "Toys brief",
          hook: "Смотри что внутри",
          structure: "demo",
        },
        content_solution: {
          action_title: "Scale toys",
        },
        trust: {
          proof_quality: "exact_segment",
        },
      },
      {
        niche: "ru_cosmetics",
        platform: "instagram",
        label: "ru_cosmetics × instagram",
        lane: "validate",
        readiness_score: 76,
        brief: {
          title: "Beauty brief",
          hook: "До и после",
        },
        content_solution: {},
        generator_bundle: {
          blocked_reasons: ["trust score ниже decision-grade порога"],
        },
        trust: {
          proof_quality: "traced_transfer_only",
        },
        next_step: "Collect exact proof",
      },
    ],
  },
});

assert.equal(result.summary.total_segments, 2);
assert.equal(result.summary.usable_exact_ready_briefs, 1);
assert.equal(result.summary.exact_ready_briefs, 1);
assert.equal(result.by_niche[0]?.usable_exact_ready, 1);
assert.equal(result.by_platform[0]?.exact_ready, 1);
assert.equal(result.gap_queue[0]?.platform, "instagram");
assert.ok((result.gap_queue[0]?.missing_fields || []).includes("structure"));
assert.ok((result.gap_queue[0]?.blocked_reasons || []).includes("trust score ниже decision-grade порога"));

console.log("reelsBrainBriefCoverageAudit.test: ok");
