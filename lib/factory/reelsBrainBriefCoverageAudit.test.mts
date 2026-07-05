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

const prioritized = buildReelsBrainBriefCoverageAudit({
  segmentGenerationPacks: {
    items: [
      {
        niche: "ru_toys",
        platform: "youtube",
        readiness_score: 95,
        proof_quality: "exact_segment",
        quality_gate: { status: "ready", blocked_reasons: [] },
        segment_priority_score: 43,
        segment_priority_mode: "research_only",
      },
      {
        niche: "ru_cosmetics",
        platform: "tiktok",
        readiness_score: 74,
        proof_quality: "traced_transfer_only",
        quality_gate: { status: "needs_validation", blocked_reasons: [] },
        segment_priority_score: 96,
        segment_priority_mode: "primary",
        segment_ready_for_generation: true,
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
        readiness_score: 95,
        brief: {
          title: "YT brief",
          hook: "hook y",
          retention: "proof",
          structure: "demo",
          second_by_second: ["0-2 hook", "2-6 proof"],
          visual_recipe: ["macro"],
          audio_strategy: ["voice"],
          product_fit: ["toys"],
          copy_as_mechanic: ["tempo"],
          do_not_copy: ["literal copy"],
        },
        content_solution: { action_title: "Scale yt", success_metric: "hook rate" },
        trust: { proof_quality: "exact_segment" },
        segment_priority_score: 43,
        segment_priority_mode: "research_only",
      },
      {
        niche: "ru_cosmetics",
        platform: "tiktok",
        label: "ru_cosmetics × tiktok",
        lane: "validate",
        readiness_score: 74,
        brief: {
          title: "TT brief",
          hook: "hook t",
          retention: "ugc proof",
          structure: "ugc",
          second_by_second: ["0-2 hook", "2-5 proof"],
          visual_recipe: ["handheld"],
          audio_strategy: ["voice"],
          product_fit: ["beauty"],
          copy_as_mechanic: ["surprise"],
          do_not_copy: ["literal copy"],
        },
        content_solution: { action_title: "Validate tt", success_metric: "retention" },
        trust: { proof_quality: "traced_transfer_only" },
        segment_priority_score: 96,
        segment_priority_mode: "primary",
      },
    ],
  },
});

assert.equal(prioritized.gap_queue[0]?.platform, "tiktok");
assert.equal(prioritized.gap_queue[0]?.segment_priority_mode, "primary");
assert.equal(prioritized.summary.primary_priority_segments, 1);

console.log("reelsBrainBriefCoverageAudit.test: ok");
