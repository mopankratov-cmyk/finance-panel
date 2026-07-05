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
    niches: ["ru_toys", "ru_cosmetics"],
    platforms: ["instagram", "youtube", "tiktok"],
  });

  assert.equal(result.summary.total_segments, 3);
  assert.equal(result.summary.ready_now, 1);
  assert.equal(result.by_niche[0]?.niche, "ru_toys");
  assert.equal(result.by_niche[0]?.primary?.label, "ru_toys × instagram");
  assert.deepEqual(result.by_niche[0]?.coverage_labels, ["instagram", "youtube"]);
  assert.equal(result.by_platform[0]?.platform, "instagram");
  assert.equal(result.by_platform[0]?.primary?.trust_band, "high");
  assert.equal(result.by_niche[1]?.next_gap?.production_state, "research_only");
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
    niches: ["ru_toys"],
    platforms: ["instagram", "youtube"],
  });

  assert.equal(result.by_niche[0]?.primary?.label, "ru_toys × instagram");
  assert.equal(result.by_niche[0]?.publishable_exact, true);
  assert.equal(result.summary.publishable_exact_segments, 1);
});
