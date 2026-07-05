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
          retention: "быстрый reveal",
          structure: "demo",
          second_by_second: ["0-2 hook", "2-6 reveal"],
          visual_recipe: ["macro hands", "product close-up"],
          audio_strategy: ["fast ugc voice"],
          product_fit: ["kids toys"],
          copy_as_mechanic: ["surprise reveal"],
          do_not_copy: ["literal competitor copy"],
        },
        content_solution: {
          action_title: "Scale toys",
          success_metric: "hook rate",
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
          retention: "show transformation",
          second_by_second: ["0-2 before", "2-6 after"],
          audio_strategy: ["voiceover"],
          product_fit: ["beauty"],
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
assert.ok((result.gap_queue[0]?.missing_fields || []).includes("visual recipe"));
assert.ok((result.gap_queue[0]?.missing_field_families || []).includes("visual"));
assert.ok((result.gap_queue[0]?.blocked_reasons || []).includes("trust score ниже decision-grade порога"));
assert.equal((result.summary.missing_field_hotspots || [])[0]?.label, "content action");
assert.equal((result.summary.missing_family_hotspots || [])[0]?.label, "execution");

console.log("reelsBrainBriefCoverageAudit.test: ok");
