import assert from "node:assert/strict";
import { buildReelsBrainExactSegmentQueue } from "./reelsBrainExactSegmentQueue";

const result = buildReelsBrainExactSegmentQueue({
  portfolioReadiness: {
    summary: {
      expected_segments: 4,
    },
    missing_segments: [
      {
        niche: "ru_toys",
        platform: "instagram",
        evidence_band: "forming",
        stability_score: 62,
        outcome_status: "no_feedback",
        missing: false,
        blockers: ["need exact winners"],
      },
      {
        niche: "ru_cosmetics",
        platform: "youtube",
        evidence_band: "missing",
        stability_score: 0,
        outcome_status: "no_feedback",
        missing: true,
      },
    ],
  },
  generationPolicy: {
    by_segment: [
      {
        niche: "ru_toys",
        platform: "instagram",
        policy_mode: "primary",
        outcome_status: "no_feedback",
      },
    ],
  },
  segmentPriorityQueue: {
    items: [
      {
        niche: "ru_toys",
        platform: "instagram",
        urgency_score: 88,
        action: "collect_segment_batch",
        readiness_dominant_gap: "audio",
        readiness_dominant_gap_count: 12,
      },
      {
        niche: "ru_cosmetics",
        platform: "youtube",
        urgency_score: 91,
        action: "collect_segment_batch",
      },
    ],
  },
  segmentSolutionMatrix: {
    by_platform: [
      {
        platform: "instagram",
        primary: {
          niche: "ru_clothing",
          platform: "instagram",
          label: "ru_clothing × instagram",
          trust_band: "high",
          readiness_score: 87,
          trust_summary: { evidence_band: "stable" },
        },
      },
    ],
    by_niche: [
      {
        niche: "ru_toys",
        primary: {
          niche: "ru_toys",
          platform: "tiktok",
          label: "ru_toys × tiktok",
          trust_band: "high",
          readiness_score: 84,
          trust_summary: { evidence_band: "stable" },
        },
      },
    ],
  },
});

assert.equal(result.summary.total_gap_segments, 2);
assert.equal(result.summary.borrowed_brief_segments, 1);
assert.equal(result.summary.missing_exact_segments, 1);
assert.equal(result.items[0]?.status, "missing_exact_segment");
assert.equal(result.items[1]?.status, "borrowed_brief_only");
assert.equal(result.items[1]?.transfer_support.length, 2);
assert.match(result.items[1]?.blockers[1] || "", /transfer signal/i);

console.log("reelsBrainExactSegmentQueue: passed");
