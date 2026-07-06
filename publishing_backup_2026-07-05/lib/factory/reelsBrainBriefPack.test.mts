import assert from "node:assert/strict";
import { buildGroupedReelsBrainBriefPacks, buildReelsBrainBriefPack } from "./reelsBrainBriefPack";

function testBuildBriefPackRanksByOpScoreAndConfidence() {
  const pack = buildReelsBrainBriefPack([
    {
      id: "tiktok_toys_best",
      title: "TikTok Toys Best",
      op_score: 92,
      confidence: "high",
      niches: ["ru_toys"],
      platforms: ["tiktok"],
      creative_brief: {
        hook: "Смотри что делает",
        retention_mechanic: "open loop",
        second_by_second: ["0-2с хук", "2-5с proof"],
        visual_recipe: ["close-up proof"],
        audio_strategy: ["fast voice"],
        product_fit: ["toy demo"],
      },
      examples: [{ reference_id: "r1" }],
      evidence: {
        trust_decision: {
          rebuild_alignment: {
            status: "aligned",
            score: 44,
            reasons: ["память пересобиралась с platform focus на tiktok"],
          },
          rebuild_context: {
            execution_mode: "brief_bundle_completion",
            focus_platform: "tiktok",
          },
        },
      },
    },
    {
      id: "tiktok_toys_alt",
      title: "TikTok Toys Alt",
      op_score: 81,
      confidence: "medium",
      niches: ["ru_toys"],
      platforms: ["tiktok"],
      creative_brief: {
        hook: "Я не ожидала",
        retention_mechanic: "proof",
      },
    },
  ], 3, {
    segmentReadiness: [
      {
        niche: "ru_toys",
        platform: "tiktok",
        total_backlog: 0,
        dominant_gap: { key: "analyze", count: 0 },
        direct_rate: 88,
        audio_rate: 82,
        transcript_ready_rate: 75,
        analyzed_rate: 70,
      },
    ],
  });

  assert.equal(pack.primary?.recipe_id, "tiktok_toys_best");
  assert.equal(pack.alternatives.length, 1);
  assert.equal(pack.summary.total, 2);
  assert.equal(pack.summary.high_confidence, 1);
  assert.equal(pack.primary?.readiness_status, "backed");
  assert.equal(pack.primary?.memory_context?.rebuild_alignment?.status, "aligned");
  assert.equal(pack.decision_pack?.rebuild_alignment?.status, "aligned");
  assert.match(String(pack.decision_pack?.memory_note), /пересобиралась под близкий output context/i);
}

function testBuildBriefPackDemotesReadinessThinRecipe() {
  const pack = buildReelsBrainBriefPack([
    {
      id: "yt_toys_high_but_thin",
      title: "YouTube Toys Thin",
      op_score: 95,
      confidence: "high",
      niches: ["ru_toys"],
      platforms: ["youtube"],
      creative_brief: {
        hook: "Смотри быстро",
        retention_mechanic: "open loop",
      },
    },
    {
      id: "tt_toys_backed",
      title: "TikTok Toys Backed",
      op_score: 88,
      confidence: "medium",
      niches: ["ru_toys"],
      platforms: ["tiktok"],
      creative_brief: {
        hook: "Я не ожидала",
        retention_mechanic: "proof",
      },
    },
  ], 3, {
    segmentReadiness: [
      {
        niche: "ru_toys",
        platform: "youtube",
        total_backlog: 20,
        dominant_gap: { key: "audio", count: 11 },
        direct_rate: 74,
        audio_rate: 18,
        transcript_ready_rate: 10,
        analyzed_rate: 42,
      },
      {
        niche: "ru_toys",
        platform: "tiktok",
        total_backlog: 0,
        dominant_gap: { key: "analyze", count: 0 },
        direct_rate: 90,
        audio_rate: 85,
        transcript_ready_rate: 80,
        analyzed_rate: 77,
      },
    ],
  });

  assert.equal(pack.primary?.recipe_id, "tt_toys_backed");
  assert.equal(pack.alternatives[0]?.recipe_id, "yt_toys_high_but_thin");
  assert.equal(pack.alternatives[0]?.readiness_status, "thin");
}

function testGroupedBriefPacksSplitByNicheAndPlatform() {
  const grouped = buildGroupedReelsBrainBriefPacks({
    recipes: [
      {
        id: "tiktok_toys_best",
        title: "TikTok Toys Best",
        op_score: 92,
        confidence: "high",
        niches: ["ru_toys"],
        platforms: ["tiktok"],
        creative_brief: { hook: "Смотри что делает", retention_mechanic: "open loop" },
      },
      {
        id: "insta_cosmetics_best",
        title: "Instagram Cosmetics Best",
        op_score: 86,
        confidence: "medium",
        niches: ["ru_cosmetics"],
        platforms: ["instagram"],
        creative_brief: { hook: "Я не ожидала", retention_mechanic: "proof" },
      },
    ],
    limit: 2,
  });

  assert.equal(grouped.by_niche.length, 2);
  assert.equal(grouped.by_platform.length, 2);
  assert.equal(grouped.by_platform.find((row) => row.platform === "tiktok")?.primary?.recipe_id, "tiktok_toys_best");
  assert.equal(grouped.by_platform.find((row) => row.platform === "instagram")?.primary?.recipe_id, "insta_cosmetics_best");
}

function testBriefPackPrioritizesHighPayoffSegment() {
  const pack = buildReelsBrainBriefPack([
    {
      id: "high_op_research_only",
      title: "High OP Research",
      op_score: 94,
      confidence: "high",
      niches: ["ru_toys"],
      platforms: ["youtube"],
      creative_brief: {
        hook: "Смотри до конца",
        retention_mechanic: "open loop",
      },
    },
    {
      id: "slightly_lower_but_primary",
      title: "Primary Segment Winner",
      op_score: 88,
      confidence: "medium",
      niches: ["ru_toys"],
      platforms: ["tiktok"],
      creative_brief: {
        hook: "Я не ожидала",
        retention_mechanic: "proof",
      },
    },
  ], 3, {
    segmentPriorityQueue: [
      {
        niche: "ru_toys",
        platform: "tiktok",
        decision_priority_score: 91,
        urgency_score: 84,
        ready_for_generation: true,
        policy_mode: "primary",
        recommended_upgrade: {
          projected_trust_gain_score: 22,
          projected_production_state: "decision_ready",
          unlocked_output: "platform-specific briefs",
        },
      },
      {
        niche: "ru_toys",
        platform: "youtube",
        decision_priority_score: 38,
        urgency_score: 30,
        ready_for_generation: false,
        policy_mode: "research_only",
      },
    ],
    generationPolicy: {
      by_segment: [
        {
          niche: "ru_toys",
          platform: "tiktok",
          policy_mode: "primary",
          decision_priority_score: 91,
          recommended_upgrade: {
            projected_trust_gain_score: 22,
            projected_production_state: "decision_ready",
            unlocked_output: "platform-specific briefs",
          },
        },
      ],
    },
  });

  assert.equal(pack.primary?.recipe_id, "slightly_lower_but_primary");
  assert.equal(pack.primary?.segment_priority_mode, "primary");
  assert.equal(pack.primary?.segment_ready_for_generation, true);
  assert.equal(pack.primary?.projected_production_state, "decision_ready");
  assert.equal(pack.primary?.trust.proof_quality, "untraced");
  assert.equal(pack.summary.primary_policy_mode, "primary");
}

function testGroupedBriefPacksSortBySegmentPriority() {
  const grouped = buildGroupedReelsBrainBriefPacks({
    recipes: [
      {
        id: "yt_toys",
        title: "YT Toys",
        op_score: 93,
        confidence: "high",
        niches: ["ru_toys"],
        platforms: ["youtube"],
        creative_brief: { hook: "Досмотри", retention_mechanic: "open loop" },
      },
      {
        id: "tt_cosmetics",
        title: "TT Cosmetics",
        op_score: 87,
        confidence: "medium",
        niches: ["ru_cosmetics"],
        platforms: ["tiktok"],
        creative_brief: { hook: "Смотри эффект", retention_mechanic: "proof" },
      },
    ],
    limit: 2,
    segmentPriorityQueue: [
      {
        niche: "ru_cosmetics",
        platform: "tiktok",
        decision_priority_score: 95,
        policy_mode: "primary",
        ready_for_generation: true,
      },
      {
        niche: "ru_toys",
        platform: "youtube",
        decision_priority_score: 35,
        policy_mode: "research_only",
      },
    ],
  });

  assert.equal(grouped.by_niche[0]?.niche, "ru_cosmetics");
  assert.equal(grouped.by_platform[0]?.platform, "tiktok");
  assert.equal(grouped.by_segment[0]?.platform, "tiktok");
}

function testBriefPackSurfacesTrustAwarePolicyContext() {
  const pack = buildReelsBrainBriefPack([
    {
      id: "exact_ready_recipe",
      title: "Exact Ready Recipe",
      op_score: 86,
      confidence: "medium",
      niches: ["ru_clothing"],
      platforms: ["instagram"],
      creative_brief: {
        hook: "Показываю посадку",
        retention_mechanic: "proof frame",
      },
    },
    {
      id: "transfer_only_recipe",
      title: "Transfer Only Recipe",
      op_score: 91,
      confidence: "high",
      niches: ["ru_clothing"],
      platforms: ["youtube"],
      creative_brief: {
        hook: "Смотри материал",
        retention_mechanic: "open loop",
      },
    },
  ], 3, {
    generationPolicy: {
      by_segment: [
        {
          niche: "ru_clothing",
          platform: "instagram",
          policy_mode: "primary",
          decision_priority_score: 88,
          trust_band: "high",
          evidence_band: "stable",
          high_trust_generation_ready: true,
          proof_quality: "exact_segment",
          publishable_exact: true,
          outcome_status: "proven",
          outcome_confidence: "high",
          policy_reason: "exact proof already closed",
        },
        {
          niche: "ru_clothing",
          platform: "youtube",
          policy_mode: "primary",
          decision_priority_score: 93,
          trust_band: "medium",
          evidence_band: "forming",
          high_trust_generation_ready: false,
          proof_quality: "traced_transfer_only",
          publishable_exact: false,
          outcome_status: "promising",
          outcome_confidence: "medium",
          policy_reason: "still borrowed from transfer evidence",
        },
      ],
    },
    segmentPriorityQueue: [
      {
        niche: "ru_clothing",
        platform: "instagram",
        decision_priority_score: 88,
        policy_mode: "primary",
        ready_for_generation: true,
      },
      {
        niche: "ru_clothing",
        platform: "youtube",
        decision_priority_score: 93,
        policy_mode: "primary",
        ready_for_generation: true,
      },
    ],
  });

  assert.equal(pack.primary?.recipe_id, "exact_ready_recipe");
  assert.equal(pack.primary?.trust.proof_quality, "exact_segment");
  assert.equal(pack.primary?.trust.high_trust_generation_ready, true);
  assert.equal(pack.primary?.trust.publishable_exact, true);
  assert.equal(pack.primary?.trust.outcome_status, "proven");
  assert.match(String(pack.primary?.trust.policy_reason), /exact proof/i);
  assert.equal(pack.alternatives[0]?.trust.proof_quality, "traced_transfer_only");
  assert.equal(pack.summary.exact_proof_ready, 1);
  assert.equal(pack.summary.generation_ready, 1);
  assert.equal(pack.summary.weak_outcomes, 0);
}

function run() {
  testBuildBriefPackRanksByOpScoreAndConfidence();
  testBuildBriefPackDemotesReadinessThinRecipe();
  testGroupedBriefPacksSplitByNicheAndPlatform();
  testBriefPackPrioritizesHighPayoffSegment();
  testGroupedBriefPacksSortBySegmentPriority();
  testBriefPackSurfacesTrustAwarePolicyContext();
  console.log("reelsBrainBriefPack.test: ok");
}

run();
