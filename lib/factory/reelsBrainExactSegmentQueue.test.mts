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
  discoveryBrain: {
    providers: [
      { provider: "apify_tiktok", decision: "scale", reason: "cheap tiktok yield", discovery_score: 82 },
      { provider: "youtube", decision: "watch", reason: "healthy youtube lane", discovery_score: 58 },
      { provider: "apify_instagram", decision: "scale", reason: "best instagram lane", discovery_score: 91 },
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
        readiness_direct_rate: 74,
        readiness_audio_rate: 41,
        readiness_transcript_ready_rate: 33,
        readiness_analyzed_rate: 58,
        readiness_total_backlog: 18,
      },
      {
        niche: "ru_cosmetics",
        platform: "youtube",
        urgency_score: 91,
        action: "collect_segment_batch",
        readiness_direct_rate: 21,
        readiness_audio_rate: 6,
        readiness_transcript_ready_rate: 0,
        readiness_analyzed_rate: 12,
        readiness_total_backlog: 41,
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
assert.ok((result.summary.avg_expected_trust_gain as number) > 0);
assert.ok((result.summary.avg_eta_ticks as number) >= 1);
assert.equal(result.items[0]?.status, "missing_exact_segment");
assert.equal(result.items[1]?.status, "borrowed_brief_only");
assert.equal(result.items[1]?.transfer_support.length, 2);
assert.ok((result.items[0]?.expected_trust_gain as number) > 0);
assert.ok((result.items[0]?.eta_ticks as number) >= 1);
assert.ok((result.items[0]?.efficiency_score as number) > 0);
assert.ok((result.items[0]?.data_readiness_score as number) >= 0);
assert.ok(typeof result.items[0]?.source_provider === "string");
assert.ok(typeof result.items[0]?.source_discovery_mode === "string");
assert.match(result.items[1]?.blockers[1] || "", /transfer signal/i);

const rankedByEfficiency = buildReelsBrainExactSegmentQueue({
  portfolioReadiness: {
    summary: {
      expected_segments: 5,
    },
    missing_segments: [
      {
        niche: "ru_cosmetics",
        platform: "youtube",
        evidence_band: "forming",
        stability_score: 72,
        outcome_status: "no_feedback",
        missing: false,
      },
      {
        niche: "ru_clothing",
        platform: "instagram",
        evidence_band: "forming",
        stability_score: 38,
        outcome_status: "no_feedback",
        missing: false,
      },
    ],
  },
  generationPolicy: {
    by_segment: [
      {
        niche: "ru_cosmetics",
        platform: "youtube",
        policy_mode: "primary",
        outcome_status: "no_feedback",
      },
      {
        niche: "ru_clothing",
        platform: "instagram",
        policy_mode: "research_only",
        outcome_status: "no_feedback",
      },
    ],
  },
  discoveryBrain: {
    providers: [
      { provider: "youtube", decision: "scale", reason: "best youtube source", discovery_score: 88 },
      { provider: "apify_instagram", decision: "watch", reason: "usable instagram source", discovery_score: 49 },
    ],
  },
  segmentPriorityQueue: {
    items: [
      {
        niche: "ru_cosmetics",
        platform: "youtube",
        urgency_score: 74,
        action: "collect_segment_batch",
        readiness_direct_rate: 88,
        readiness_audio_rate: 72,
        readiness_transcript_ready_rate: 61,
        readiness_analyzed_rate: 66,
        readiness_total_backlog: 9,
      },
      {
        niche: "ru_clothing",
        platform: "instagram",
        urgency_score: 96,
        action: "collect_segment_batch",
        readiness_dominant_gap_count: 15,
        readiness_direct_rate: 36,
        readiness_audio_rate: 14,
        readiness_transcript_ready_rate: 4,
        readiness_analyzed_rate: 21,
        readiness_total_backlog: 31,
      },
    ],
  },
  segmentSolutionMatrix: {
    by_platform: [
      {
        platform: "youtube",
        primary: {
          niche: "ru_toys",
          platform: "youtube",
          label: "ru_toys × youtube",
          trust_band: "high",
          readiness_score: 86,
          trust_summary: { evidence_band: "stable" },
        },
      },
      {
        platform: "instagram",
        primary: {
          niche: "ru_toys",
          platform: "instagram",
          label: "ru_toys × instagram",
          trust_band: "medium",
          readiness_score: 61,
          trust_summary: { evidence_band: "forming" },
        },
      },
    ],
    by_niche: [],
  },
});

assert.equal(rankedByEfficiency.items[0]?.niche, "ru_cosmetics");
assert.ok((rankedByEfficiency.items[0]?.efficiency_score as number) >= (rankedByEfficiency.items[1]?.efficiency_score as number));
assert.ok((rankedByEfficiency.items[0]?.data_readiness_score as number) > (rankedByEfficiency.items[1]?.data_readiness_score as number));
assert.equal(rankedByEfficiency.items[0]?.source_provider, "youtube");
assert.ok(["pin_winner_provider", "close_exact_proof", "controlled_discovery", "seed_and_collect", "probe_and_collect"].includes(String(rankedByEfficiency.items[0]?.source_discovery_mode)));
assert.ok(Array.isArray(rankedByEfficiency.summary.provider_recommendations));
assert.equal(result.summary.primary_priority_segments, 1);

const prioritizedByPolicy = buildReelsBrainExactSegmentQueue({
  portfolioReadiness: {
    summary: {
      expected_segments: 3,
    },
    missing_segments: [
      {
        niche: "ru_toys",
        platform: "youtube",
        evidence_band: "forming",
        stability_score: 78,
        outcome_status: "no_feedback",
        missing: false,
      },
      {
        niche: "ru_cosmetics",
        platform: "tiktok",
        evidence_band: "forming",
        stability_score: 45,
        outcome_status: "no_feedback",
        missing: false,
      },
    ],
  },
  generationPolicy: {
    by_segment: [
      {
        niche: "ru_cosmetics",
        platform: "tiktok",
        policy_mode: "primary",
        outcome_status: "no_feedback",
      },
      {
        niche: "ru_toys",
        platform: "youtube",
        policy_mode: "research_only",
        outcome_status: "no_feedback",
      },
    ],
  },
  discoveryBrain: {
    providers: [
      { provider: "youtube", decision: "scale", reason: "best youtube source", discovery_score: 88 },
      { provider: "apify_tiktok", decision: "watch", reason: "usable tiktok source", discovery_score: 60 },
    ],
  },
  segmentPriorityQueue: {
    items: [
      {
        niche: "ru_toys",
        platform: "youtube",
        urgency_score: 74,
        action: "collect_segment_batch",
        readiness_direct_rate: 88,
        readiness_audio_rate: 72,
        readiness_transcript_ready_rate: 61,
        readiness_analyzed_rate: 66,
        readiness_total_backlog: 9,
      },
      {
        niche: "ru_cosmetics",
        platform: "tiktok",
        urgency_score: 90,
        action: "collect_segment_batch",
        readiness_direct_rate: 42,
        readiness_audio_rate: 18,
        readiness_transcript_ready_rate: 10,
        readiness_analyzed_rate: 31,
        readiness_total_backlog: 24,
        ready_for_generation: true,
      },
    ],
  },
  segmentSolutionMatrix: {
    by_platform: [],
    by_niche: [],
  },
});

assert.equal(prioritizedByPolicy.items[0]?.platform, "tiktok");
assert.equal(prioritizedByPolicy.items[0]?.segment_priority_mode, "primary");

console.log("reelsBrainExactSegmentQueue: passed");
