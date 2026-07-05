import assert from "node:assert/strict";
import { buildReelsBrainSegmentPriorityQueue } from "./reelsBrainSegmentPriorityQueue";

function testBuildReelsBrainSegmentPriorityQueueBlendsGenerationAndLearningNeeds() {
  const result = buildReelsBrainSegmentPriorityQueue({
    segmentPlan: {
      focus_segments: [
        {
          niche: "ru_toys",
          platform: "tiktok",
          status: "grow_corpus",
          gap_score: 61,
          gap: { total_videos: 120, analyzed_videos: 38, stable_patterns: 1 },
          next_action: "Добрать trust-floor по TikTok toys",
        },
        {
          niche: "ru_cosmetics",
          platform: "instagram",
          status: "analyze_more",
          gap_score: 48,
          gap: { total_videos: 40, analyzed_videos: 18, stable_patterns: 1 },
          next_action: "Дожать анализ сегмента",
        },
      ],
    },
    segmentDecisionDeck: {
      items: [
        {
          niche: "ru_toys",
          platform: "tiktok",
          decision_grade: "ship",
          generation_mode: "decision_ready",
          ready_for_generation: true,
          trust_score: 91,
          brief: { title: "Toys TT brief", hook: "Смотри что внутри" },
          action: { title: "Scale toys", decision: "scale" },
          hypothesis: { title: "Reveal hypothesis" },
          why_now: "strong corpus and market fit",
        },
        {
          niche: "ru_cosmetics",
          platform: "instagram",
          decision_grade: "prepare",
          generation_mode: "brief_only",
          ready_for_generation: false,
          trust_score: 64,
          brief: { title: "Beauty IG brief", hook: "До и после" },
        },
      ],
    },
    segmentStabilityAudit: {
      items: [
        {
          niche: "ru_toys",
          platform: "tiktok",
          evidence_band: "stable",
          high_trust_segment: true,
          stability_score: 93,
          blockers: [],
        },
        {
          niche: "ru_cosmetics",
          platform: "instagram",
          evidence_band: "forming",
          high_trust_segment: false,
          stability_score: 68,
          blockers: ["fewer than 3 stable patterns"],
        },
      ],
    },
    generationPolicy: {
      by_segment: [
        {
          niche: "ru_toys",
          platform: "tiktok",
          policy_mode: "primary",
          policy_reason: "segment is already publishable exact",
          decision_priority_score: 96,
          next_upgrade: {
            unlocked_output: "publishable_exact_brief",
            projected_trust_gain_score: 28,
            projected_trust_gain_band: "high",
            recommended_loop: "analyze_and_compact",
          },
        },
        {
          niche: "ru_cosmetics",
          platform: "instagram",
          policy_mode: "control_only",
          policy_reason: "segment still needs one validation loop",
          decision_priority_score: 74,
          next_upgrade: {
            unlocked_output: "generator_ready_brief",
            projected_trust_gain_score: 16,
            projected_trust_gain_band: "medium",
            recommended_loop: "media_backfill",
          },
        },
      ],
    },
    feedbackLoop: {
      by_segment: [
        {
          niche: "ru_toys",
          platform: "tiktok",
          status: "proven",
          proof_quality: "exact_segment",
          winners: 3,
          losers: 0,
          traced_posts: 4,
          exact_segment_posts: 2,
          generation_ready_posts: 1,
        },
        {
          niche: "ru_cosmetics",
          platform: "instagram",
          status: "promising",
          proof_quality: "traced_transfer_only",
          winners: 1,
          losers: 0,
          traced_posts: 2,
          exact_segment_posts: 0,
          generation_ready_posts: 0,
        },
      ],
      segment_outcome_memory: {
        trust_update_queue: [
          {
            segment: "ru_toys × tiktok",
            trust_action: "promote_segment_trust",
            evidence: "3 winners / 4 posts · exact 2",
          },
          {
            segment: "ru_cosmetics × instagram",
            trust_action: "keep_validating_segment",
            evidence: "1 winners / 2 posts · exact 0",
          },
        ],
      },
    },
  });

  assert.equal(result.summary.total, 2);
  assert.equal(result.summary.promote_segment_briefs, 1);
  assert.equal(result.summary.validate_segment_briefs, 1);
  assert.equal(result.summary.ready_for_generation, 2);
  assert.equal(result.summary.high_trust_segments, 1);
  assert.equal(result.summary.proven_outcomes, 1);
  assert.equal(result.summary.weak_outcomes, 0);
  assert.equal(result.summary.exact_feedback_segments, 1);
  assert.equal(result.items[0]?.niche, "ru_toys");
  assert.equal(result.items[0]?.action, "promote_segment_briefs");
  assert.equal(result.items[0]?.ready_for_generation, true);
  assert.equal(result.items[0]?.evidence_band, "stable");
  assert.equal(result.items[0]?.policy_mode, "primary");
  assert.equal(result.items[0]?.decision_priority_score, 100);
  assert.equal(result.items[0]?.outcome_status, "proven");
  assert.equal(result.items[0]?.proof_quality, "exact_segment");
  assert.equal(result.items[0]?.trust_action, "promote_segment_trust");
  assert.match(String(result.items[0]?.trust_evidence), /exact 2/);
  assert.equal(result.items[0]?.recommended_upgrade?.unlocked_output, "publishable_exact_brief");
  assert.equal(result.items[1]?.action, "validate_segment_briefs");
  assert.equal(result.items[1]?.policy_mode, "control_only");
  assert.equal(result.items[1]?.outcome_status, "promising");
}

function run() {
  testBuildReelsBrainSegmentPriorityQueueBlendsGenerationAndLearningNeeds();
  testBuildReelsBrainSegmentPriorityQueueRespectsReadinessBlocks();
  testBuildReelsBrainSegmentPriorityQueueLetsPolicyOverrideWeakDecisionDeck();
  console.log("reelsBrainSegmentPriorityQueue.test: ok");
}

run();

function testBuildReelsBrainSegmentPriorityQueueRespectsReadinessBlocks() {
  const result = buildReelsBrainSegmentPriorityQueue({
    segmentPlan: {
      focus_segments: [
        {
          niche: "ru_toys",
          platform: "youtube",
          status: "grow_corpus",
          gap_score: 56,
          gap: { total_videos: 84, analyzed_videos: 21, stable_patterns: 1 },
        },
      ],
    },
    segmentDecisionDeck: {
      items: [
        {
          niche: "ru_toys",
          platform: "youtube",
          decision_grade: "ship",
          generation_mode: "decision_ready",
          ready_for_generation: true,
          trust_score: 88,
        },
      ],
    },
    segmentStabilityAudit: {
      items: [
        {
          niche: "ru_toys",
          platform: "youtube",
          evidence_band: "stable",
          high_trust_segment: true,
          stability_score: 90,
        },
      ],
    },
    segmentReadinessWatchlist: {
      items: [
        {
          niche: "ru_toys",
          platform: "youtube",
          total: 84,
          total_backlog: 33,
          dominant_gap: { key: "audio", count: 18, label: "audio" },
          direct_rate: 77,
          audio_rate: 22,
          transcript_ready_rate: 15,
          analyzed_rate: 25,
        },
      ],
    },
    generationPolicy: {
      by_segment: [
        {
          niche: "ru_toys",
          platform: "youtube",
          policy_mode: "primary",
          policy_reason: "policy is strong but blocked by audio readiness",
          decision_priority_score: 91,
          next_upgrade: {
            unlocked_output: "performance_tuned_brief",
            projected_trust_gain_score: 24,
            projected_trust_gain_band: "high",
            recommended_loop: "audio_backfill",
          },
        },
      ],
    },
    feedbackLoop: {
      by_segment: [
        {
          niche: "ru_toys",
          platform: "youtube",
          status: "weak",
          proof_quality: "exact_segment",
          winners: 0,
          losers: 2,
          traced_posts: 2,
          exact_segment_posts: 2,
          generation_ready_posts: 0,
        },
      ],
      segment_outcome_memory: {
        trust_update_queue: [
          {
            segment: "ru_toys × youtube",
            trust_action: "review_or_penalize_segment",
            evidence: "0 winners / 2 posts",
          },
        ],
      },
    },
  });

  assert.equal(result.summary.readiness_blocked, 1);
  assert.equal(result.summary.promote_segment_briefs, 0);
  assert.equal(result.summary.weak_outcomes, 1);
  assert.equal(result.items[0]?.readiness_blocked, true);
  assert.equal(result.items[0]?.ready_for_generation, false);
  assert.equal(result.items[0]?.outcome_status, "weak");
  assert.equal(result.items[0]?.trust_action, "review_or_penalize_segment");
  assert.equal(result.items[0]?.readiness_dominant_gap, "audio");
  assert.equal(result.items[0]?.action, "collect_segment_batch");
  assert.equal(result.items[0]?.policy_mode, "primary");
  assert.equal(result.items[0]?.recommended_upgrade?.recommended_loop, "audio_backfill");
}

function testBuildReelsBrainSegmentPriorityQueueLetsPolicyOverrideWeakDecisionDeck() {
  const result = buildReelsBrainSegmentPriorityQueue({
    segmentPlan: {
      focus_segments: [
        {
          niche: "ru_clothing",
          platform: "instagram",
          status: "analyze_more",
          gap_score: 52,
          gap: { total_videos: 58, analyzed_videos: 31, stable_patterns: 2 },
        },
        {
          niche: "ru_toys",
          platform: "youtube",
          status: "grow_corpus",
          gap_score: 59,
          gap: { total_videos: 96, analyzed_videos: 37, stable_patterns: 1 },
        },
      ],
    },
    segmentDecisionDeck: {
      items: [
        {
          niche: "ru_clothing",
          platform: "instagram",
          decision_grade: "research",
          generation_mode: "research_only",
          ready_for_generation: false,
          trust_score: 71,
        },
      ],
    },
    segmentStabilityAudit: {
      items: [
        {
          niche: "ru_clothing",
          platform: "instagram",
          evidence_band: "stable",
          high_trust_segment: true,
          stability_score: 88,
        },
        {
          niche: "ru_toys",
          platform: "youtube",
          evidence_band: "forming",
          high_trust_segment: false,
          stability_score: 63,
        },
      ],
    },
    generationPolicy: {
      by_segment: [
        {
          niche: "ru_clothing",
          platform: "instagram",
          policy_mode: "primary",
          policy_reason: "segment has the strongest exact-ready policy",
          decision_priority_score: 93,
          next_upgrade: {
            unlocked_output: "publishable_visual_brief",
            projected_trust_gain_score: 31,
            projected_trust_gain_band: "high",
            recommended_loop: "media_backfill",
          },
        },
      ],
    },
    feedbackLoop: {
      by_segment: [
        {
          niche: "ru_clothing",
          platform: "instagram",
          status: "proven",
          proof_quality: "exact_segment",
          winners: 2,
          losers: 0,
          traced_posts: 3,
          exact_segment_posts: 1,
          generation_ready_posts: 1,
        },
      ],
      segment_outcome_memory: {
        trust_update_queue: [
          {
            segment: "ru_clothing × instagram",
            trust_action: "promote_segment_trust",
            evidence: "2 winners / 3 posts",
          },
        ],
      },
    },
  });

  assert.equal(result.items[0]?.niche, "ru_clothing");
  assert.equal(result.items[0]?.platform, "instagram");
  assert.equal(result.items[0]?.action, "promote_segment_briefs");
  assert.equal(result.items[0]?.policy_mode, "primary");
  assert.equal(result.items[0]?.ready_for_generation, true);
  assert.equal(result.items[0]?.outcome_status, "proven");
  assert.equal(result.items[0]?.proof_quality, "exact_segment");
  assert.match(String(result.items[0]?.policy_reason), /strongest exact-ready policy/i);
}
