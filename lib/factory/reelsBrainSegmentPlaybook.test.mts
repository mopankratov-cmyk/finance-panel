import assert from "node:assert/strict";
import { buildReelsBrainSegmentPlaybook } from "./reelsBrainSegmentPlaybook";

function testBuildReelsBrainSegmentPlaybookRanksReadySegments() {
  const result = buildReelsBrainSegmentPlaybook({
    opportunities: {
      top: [
        {
          niche: "ru_toys",
          platform: "tiktok",
          opportunity_score: 91,
          status: "scale_now",
          recommended_mode: "primary",
          best_brief_title: "Toys TikTok brief",
          best_brief_hook: "Смотри что внутри",
          best_action_title: "Scale toys TikTok",
          best_hypothesis_title: "Fast demo hypothesis",
          best_hypothesis: "Если начать с reveal, удержание вырастет",
        },
        {
          niche: "ru_cosmetics",
          platform: "instagram",
          opportunity_score: 61,
          status: "build_next",
          recommended_mode: "control_only",
          best_brief_title: "Cosmetics IG brief",
          best_action_title: "Validate cosmetics IG",
        },
        {
          niche: "ru_clothing",
          platform: "instagram",
          opportunity_score: 84,
          status: "scale_now",
          recommended_mode: "primary",
          best_brief_title: "Clothing IG brief",
          best_action_title: "Scale clothing IG",
        },
      ],
    },
    patternAtlas: {
      by_segment: [
        {
          niche: "ru_toys",
          platform: "tiktok",
          status: "stable",
          recommended_mode: "primary",
          avg_stability_score: 86,
          stable_pattern_count: 4,
          analyzed_videos: 88,
          total_videos: 110,
          next_step: "Можно собирать platform-specific briefs.",
          top_patterns: [
            {
              title: "Fast demo surprise",
              hook: "Смотри что внутри",
              retention: "быстрый payoff",
              format: "demo",
              final_decision: "scale",
              market_status: "proven",
              stability_score: 93,
              brief_seed: {
                hook: "Смотри что внутри",
                retention: "быстрый payoff",
                visual_recipe: ["macro reveal"],
                audio_strategy: ["fast ugc"],
              },
            },
          ],
        },
        {
          niche: "ru_cosmetics",
          platform: "instagram",
          status: "forming",
          recommended_mode: "control_only",
          avg_stability_score: 64,
          stable_pattern_count: 1,
          analyzed_videos: 27,
          total_videos: 55,
          next_step: "Нужен ещё один цикл анализа.",
          top_patterns: [
            {
              title: "Proof before after",
              hook: "Смотри до и после",
              retention: "proof frame",
              format: "ugc",
              final_decision: "control",
              market_status: "promising",
              stability_score: 67,
            },
          ],
        },
        {
          niche: "ru_clothing",
          platform: "instagram",
          status: "stable",
          recommended_mode: "primary",
          avg_stability_score: 79,
          stable_pattern_count: 3,
          analyzed_videos: 52,
          total_videos: 70,
          next_step: "Можно готовить control rollout.",
          top_patterns: [
            {
              title: "Mirror try-on",
              hook: "Смотри как сидит",
              retention: "outfit switch",
              format: "ugc",
              final_decision: "scale",
              market_status: "proven",
              stability_score: 80,
            },
          ],
        },
      ],
    },
    feedbackLoop: {
      by_segment: [
        {
          niche: "ru_toys",
          platform: "tiktok",
          status: "proven",
          posts: 6,
          winners: 3,
          losers: 0,
          traced_posts: 4,
          exact_segment_posts: 2,
          pattern_feedback_posts: 2,
          proof_quality: "exact_segment",
          trust_action: "promote_segment_trust",
        },
        {
          niche: "ru_cosmetics",
          platform: "instagram",
          status: "weak",
          posts: 3,
          winners: 0,
          losers: 2,
          traced_posts: 1,
          exact_segment_posts: 0,
          pattern_feedback_posts: 1,
          proof_quality: "traced_transfer_only",
          trust_action: "review_or_penalize_segment",
        },
        {
          niche: "ru_clothing",
          platform: "instagram",
          status: "proven",
          posts: 4,
          winners: 2,
          losers: 0,
          traced_posts: 2,
          exact_segment_posts: 0,
          pattern_feedback_posts: 2,
          proof_quality: "traced_transfer_only",
          trust_action: "keep_validating_segment",
        },
      ],
    },
    limit: 6,
  });

  assert.equal(result.summary.total, 3);
  assert.equal(result.summary.ship_now, 1);
  assert.equal(result.summary.validate_and_ship, 1);
  assert.equal(result.items[0]?.status, "ship_now");
  assert.equal(result.items[0]?.niche, "ru_toys");
  assert.equal(result.items[0]?.platform, "tiktok");
  assert.equal(result.items[0]?.brief.title, "Toys TikTok brief");
  assert.equal(result.items[0]?.leading_pattern.title, "Fast demo surprise");
  assert.equal(result.items[0]?.segment_outcome_status, "proven");
  assert.equal(result.items[0]?.segment_outcome_proof_quality, "exact_segment");
  assert.equal(result.items[0]?.segment_outcome_exact_posts, 2);
  const clothing = result.items.find((item) => item.niche === "ru_clothing");
  assert.equal(clothing?.status, "validate_and_ship");
  assert.equal(clothing?.recommended_mode, "primary");
  assert.equal(clothing?.segment_outcome_proof_quality, "traced_transfer_only");
  assert.match(clothing?.rollout?.next_step || "", /exact-segment proof/i);
  const cosmetics = result.items.find((item) => item.niche === "ru_cosmetics");
  assert.equal(cosmetics?.status, "research");
  assert.equal(cosmetics?.recommended_mode, "research_only");
  assert.equal(cosmetics?.segment_outcome_status, "weak");
}

function testSegmentPlaybookPrioritizesHighPayoffSegment() {
  const result = buildReelsBrainSegmentPlaybook({
    opportunities: {
      top: [
        {
          niche: "ru_toys",
          platform: "youtube",
          opportunity_score: 94,
          status: "scale_now",
          recommended_mode: "primary",
          best_brief_title: "YT Toys brief",
          best_action_title: "Scale yt toys",
          best_hypothesis_title: "YT Toys hypothesis",
          best_hypothesis: "Сильный ютуб паттерн",
        },
        {
          niche: "ru_cosmetics",
          platform: "tiktok",
          opportunity_score: 78,
          status: "build_next",
          recommended_mode: "control_only",
          best_brief_title: "TT Cosmetics brief",
          best_action_title: "Validate tt cosmetics",
          best_hypothesis_title: "TT Cosmetics hypothesis",
          best_hypothesis: "Перспективный тикток сегмент",
        },
      ],
    },
    patternAtlas: {
      by_segment: [
        {
          niche: "ru_toys",
          platform: "youtube",
          status: "stable",
          recommended_mode: "primary",
          avg_stability_score: 88,
          stable_pattern_count: 4,
          analyzed_videos: 96,
          total_videos: 130,
          top_patterns: [
            {
              title: "YT Toys winner",
              hook: "Смотри быстро",
              retention: "open loop",
              format: "demo",
              final_decision: "scale",
              market_status: "proven",
              stability_score: 91,
            },
          ],
        },
        {
          niche: "ru_cosmetics",
          platform: "tiktok",
          status: "forming",
          recommended_mode: "control_only",
          avg_stability_score: 66,
          stable_pattern_count: 1,
          analyzed_videos: 28,
          total_videos: 57,
          top_patterns: [
            {
              title: "TT Cosmetics winner",
              hook: "Смотри эффект",
              retention: "proof",
              format: "ugc",
              final_decision: "control",
              market_status: "promising",
              stability_score: 69,
            },
          ],
        },
      ],
    },
    feedbackLoop: {
      by_segment: [
        {
          niche: "ru_toys",
          platform: "youtube",
          status: "proven",
          posts: 4,
          winners: 2,
          proof_quality: "exact_segment",
        },
        {
          niche: "ru_cosmetics",
          platform: "tiktok",
          status: "promising",
          posts: 2,
          winners: 1,
          proof_quality: "traced_transfer_only",
        },
      ],
    },
    segmentPriorityQueue: [
      {
        niche: "ru_cosmetics",
        platform: "tiktok",
        decision_priority_score: 95,
        policy_mode: "primary",
        ready_for_generation: true,
        recommended_upgrade: {
          projected_trust_gain_score: 25,
          projected_production_state: "decision_ready",
          unlocked_output: "segment playbook",
        },
      },
      {
        niche: "ru_toys",
        platform: "youtube",
        decision_priority_score: 41,
        policy_mode: "research_only",
      },
    ],
    limit: 6,
  });

  assert.equal(result.items[0]?.niche, "ru_cosmetics");
  assert.equal(result.items[0]?.platform, "tiktok");
  assert.equal(result.items[0]?.segment_priority_mode, "primary");
  assert.equal(result.summary.primary_priority_segments, 1);
}

function testSegmentPlaybookSurfacesTrustAwareMemoryContext() {
  const result = buildReelsBrainSegmentPlaybook({
    opportunities: {
      top: [
        {
          niche: "ru_clothing",
          platform: "instagram",
          opportunity_score: 82,
          status: "build_next",
          recommended_mode: "primary",
          best_brief_title: "IG Clothing brief",
          best_action_title: "Validate IG clothing",
          best_hypothesis_title: "IG Clothing hypothesis",
          best_hypothesis: "точный сегмент должен конвертить лучше",
        },
        {
          niche: "ru_clothing",
          platform: "youtube",
          opportunity_score: 93,
          status: "scale_now",
          recommended_mode: "primary",
          best_brief_title: "YT Clothing brief",
          best_action_title: "Scale YT clothing",
          best_hypothesis_title: "YT Clothing hypothesis",
          best_hypothesis: "transfer сегмент должен удерживать",
        },
      ],
    },
    patternAtlas: {
      by_segment: [
        {
          niche: "ru_clothing",
          platform: "instagram",
          status: "stable",
          recommended_mode: "primary",
          avg_stability_score: 76,
          stable_pattern_count: 3,
          analyzed_videos: 54,
          total_videos: 73,
          top_patterns: [{ title: "IG pattern", hook: "Смотри посадку", retention: "try-on proof", format: "ugc", final_decision: "control" }],
        },
        {
          niche: "ru_clothing",
          platform: "youtube",
          status: "stable",
          recommended_mode: "primary",
          avg_stability_score: 89,
          stable_pattern_count: 4,
          analyzed_videos: 85,
          total_videos: 118,
          top_patterns: [{ title: "YT pattern", hook: "Смотри материал", retention: "review proof", format: "review", final_decision: "scale" }],
        },
      ],
    },
    feedbackLoop: {
      by_segment: [
        {
          niche: "ru_clothing",
          platform: "instagram",
          status: "proven",
          posts: 4,
          winners: 2,
          proof_quality: "traced_transfer_only",
          trust_action: "keep_validating_segment",
        },
        {
          niche: "ru_clothing",
          platform: "youtube",
          status: "proven",
          posts: 6,
          winners: 3,
          proof_quality: "traced_transfer_only",
          trust_action: "promote_segment_trust",
        },
      ],
    },
    generationPolicy: {
      by_segment: [
        {
          niche: "ru_clothing",
          platform: "instagram",
          policy_mode: "primary",
          trust_band: "high_trust",
          evidence_band: "exact",
          high_trust_generation_ready: true,
          proof_quality: "exact_segment",
          publishable_exact: true,
          policy_reason: "Exact proof already closed for this segment.",
          decision_priority_score: 88,
        },
        {
          niche: "ru_clothing",
          platform: "youtube",
          policy_mode: "primary",
          trust_band: "transfer_only",
          evidence_band: "borrowed",
          high_trust_generation_ready: false,
          proof_quality: "traced_transfer_only",
          publishable_exact: false,
          policy_reason: "Still borrowed from transfer evidence.",
          decision_priority_score: 95,
        },
      ],
    },
    limit: 6,
  });

  assert.equal(result.items[0]?.platform, "instagram");
  assert.equal(result.items[0]?.segment_outcome_proof_quality, "exact_segment");
  assert.equal(result.items[0]?.high_trust_generation_ready, true);
  assert.equal(result.items[0]?.publishable_exact, true);
  assert.equal(result.items[0]?.trust_band, "high_trust");
  assert.equal(result.items[0]?.evidence_band, "exact");
  assert.match(String(result.items[0]?.policy_reason), /Exact proof/i);
  assert.equal(result.summary.exact_proof_ready, 1);
  assert.equal(result.summary.generation_ready, 1);
}

function run() {
  testBuildReelsBrainSegmentPlaybookRanksReadySegments();
  testSegmentPlaybookPrioritizesHighPayoffSegment();
  testSegmentPlaybookSurfacesTrustAwareMemoryContext();
  console.log("reelsBrainSegmentPlaybook.test: ok");
}

run();
