import test from "node:test";
import assert from "node:assert/strict";
import { buildReelsBrainSegmentSolutionMatrix } from "./reelsBrainSegmentSolutionMatrix";

test("buildReelsBrainSegmentSolutionMatrix groups solutions by niche and platform with trust-aware primary rows", () => {
  const result = buildReelsBrainSegmentSolutionMatrix({
    segmentSolutions: {
      items: [
        {
          niche: "ru_toys",
          platform: "instagram",
          label: "ru_toys × instagram",
          readiness_score: 92,
          high_trust_generation_ready: true,
          trust_band: "high",
          production_state: "ready_now",
          creative_brief: { hook: "Покажи что внутри" },
          content_decision: { next_step: "Снять 3 тизера" },
          trust_summary: { evidence_band: "stable", stability_score: 88, blockers: [], proof_quality: "exact_segment" },
        },
        {
          niche: "ru_toys",
          platform: "youtube",
          label: "ru_toys × youtube",
          readiness_score: 58,
          trust_band: "medium",
          production_state: "controlled_test",
          creative_brief: { hook: "Сравнение до/после" },
          content_decision: { next_step: "Добрать соцдоказательство" },
          trust_summary: { evidence_band: "forming", stability_score: 54, blockers: ["мало stable patterns"] },
        },
        {
          niche: "ru_cosmetics",
          platform: "tiktok",
          label: "ru_cosmetics × tiktok",
          readiness_score: 39,
          trust_band: "low",
          production_state: "research_only",
          creative_brief: { hook: "Тест текстуры за 3 сек" },
          content_decision: { next_step: "Добрать корпус" },
          trust_summary: { evidence_band: "thin", stability_score: 24, blockers: ["low trust"] },
        },
      ],
    },
    briefGapProgress: {
      top_candidates: [
        {
          niche: "ru_toys",
          platform: "youtube",
          label: "ru_toys × youtube",
          estimated_uplift_score: 81,
          closure_stage: "close_to_publishable",
          recommended_loop: "audio_backfill",
          unlocked_output: "performance_tuned_brief",
          projected_production_state: "near_publishable",
          projected_trust_gain_score: 24,
          projected_trust_gain_band: "medium",
          primary_missing_family: "audio",
          missing_fields: ["audio strategy"],
          next_step: "Close audio layer",
          unlocked_next_step: "After audio close, this segment becomes retention-tuned.",
        },
      ],
    },
    niches: ["ru_toys", "ru_cosmetics"],
    platforms: ["instagram", "youtube", "tiktok"],
  });

  assert.equal(result.summary.total_segments, 3);
  assert.equal(result.summary.ready_now, 1);
  assert.equal(result.summary.generation_ready_segments, 1);
  assert.equal(result.by_niche[0]?.niche, "ru_toys");
  assert.equal(result.by_niche[0]?.primary?.label, "ru_toys × instagram");
  assert.equal(result.by_niche[0]?.high_trust_generation_ready, true);
  assert.deepEqual(result.by_niche[0]?.coverage_labels, ["instagram", "youtube"]);
  assert.equal(result.by_platform[0]?.platform, "instagram");
  assert.equal(result.by_platform[0]?.primary?.trust_band, "high");
  assert.equal(result.by_niche[1]?.next_gap?.production_state, "research_only");
  assert.equal(result.summary.groups_with_upgrade_forecast, 1);
  assert.equal(result.summary.avg_projected_trust_gain, 24);
  assert.equal(result.by_niche[0]?.next_upgrade?.unlocked_output, "performance_tuned_brief");
  assert.equal(result.by_niche[0]?.next_upgrade?.projected_trust_gain_score, 24);
  assert.equal((result.by_segment[1]?.upgrade_forecast as Record<string, unknown> | undefined)?.recommended_loop, "audio_backfill");
  assert.equal(result.summary.publishable_exact_segments, 1);
  assert.equal(result.by_niche[0]?.publishable_exact, true);
  assert.equal(result.by_niche[0]?.publishable_exact_segments, 1);
});

test("buildReelsBrainSegmentSolutionMatrix prefers publishable exact primary inside a group", () => {
  const result = buildReelsBrainSegmentSolutionMatrix({
    segmentSolutions: {
      items: [
        {
          niche: "ru_toys",
          platform: "instagram",
          label: "ru_toys × instagram",
          readiness_score: 82,
          high_trust_generation_ready: true,
          trust_band: "medium",
          production_state: "ready_now",
          creative_brief: { hook: "Exact winner" },
          trust_summary: { evidence_band: "stable", stability_score: 70, blockers: [], proof_quality: "exact_segment" },
        },
        {
          niche: "ru_toys",
          platform: "youtube",
          label: "ru_toys × youtube",
          readiness_score: 93,
          trust_band: "high",
          production_state: "ready_now",
          creative_brief: { hook: "Transfer stronger" },
          trust_summary: { evidence_band: "stable", stability_score: 88, blockers: [], proof_quality: "traced_transfer_only" },
        },
      ],
    },
    briefGapProgress: {
      top_candidates: [
        {
          niche: "ru_toys",
          platform: "youtube",
          label: "ru_toys × youtube",
          estimated_uplift_score: 77,
          closure_stage: "close_to_publishable",
          recommended_loop: "analyze_and_compact",
          unlocked_output: "generator_ready_brief",
          projected_production_state: "near_publishable",
          projected_trust_gain_score: 21,
          projected_trust_gain_band: "medium",
          primary_missing_family: "structure",
          missing_fields: ["structure"],
          next_step: "Close structure",
          unlocked_next_step: "After structure close, segment becomes generator-ready.",
        },
      ],
    },
    niches: ["ru_toys"],
    platforms: ["instagram", "youtube"],
  });

  assert.equal(result.by_niche[0]?.primary?.label, "ru_toys × instagram");
  assert.equal(result.by_niche[0]?.high_trust_generation_ready, true);
  assert.equal(result.by_niche[0]?.publishable_exact, true);
  assert.equal(result.summary.generation_ready_segments, 1);
  assert.equal(result.summary.publishable_exact_segments, 1);
  assert.equal((result.by_niche[0]?.next_upgrade as Record<string, unknown> | undefined)?.label, "ru_toys × youtube");
});

test("buildReelsBrainSegmentSolutionMatrix prioritizes high-payoff segment", () => {
  const result = buildReelsBrainSegmentSolutionMatrix({
    segmentSolutions: {
      items: [
        {
          niche: "ru_toys",
          platform: "youtube",
          label: "ru_toys × youtube",
          readiness_score: 94,
          trust_band: "high",
          production_state: "ready_now",
          segment_priority_score: 41,
          segment_priority_mode: "research_only",
          creative_brief: { hook: "YT hook" },
          content_decision: { next_step: "Scale yt" },
          trust_summary: { evidence_band: "stable", stability_score: 88, blockers: [], proof_quality: "exact_segment" },
        },
        {
          niche: "ru_cosmetics",
          platform: "tiktok",
          label: "ru_cosmetics × tiktok",
          readiness_score: 72,
          high_trust_generation_ready: true,
          trust_band: "medium",
          production_state: "controlled_test",
          segment_priority_score: 97,
          segment_priority_mode: "primary",
          segment_ready_for_generation: true,
          creative_brief: { hook: "TT hook" },
          content_decision: { next_step: "Validate tt" },
          trust_summary: { evidence_band: "forming", stability_score: 61, blockers: [], proof_quality: "traced_transfer_only" },
        },
      ],
    },
    briefGapProgress: {
      top_candidates: [],
    },
    niches: ["ru_toys", "ru_cosmetics"],
    platforms: ["youtube", "tiktok"],
  });

  assert.equal(result.by_segment[0]?.platform, "tiktok");
  assert.equal(result.by_segment[0]?.segment_priority_mode, "primary");
  assert.equal(result.by_segment[0]?.high_trust_generation_ready, true);
  assert.equal(result.summary.primary_priority_segments, 1);
});
