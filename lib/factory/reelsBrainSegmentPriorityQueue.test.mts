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
  });

  assert.equal(result.summary.total, 2);
  assert.equal(result.summary.promote_segment_briefs, 1);
  assert.equal(result.summary.analyze_segment_backlog, 1);
  assert.equal(result.summary.ready_for_generation, 1);
  assert.equal(result.summary.high_trust_segments, 1);
  assert.equal(result.items[0]?.niche, "ru_toys");
  assert.equal(result.items[0]?.action, "promote_segment_briefs");
  assert.equal(result.items[0]?.ready_for_generation, true);
  assert.equal(result.items[0]?.evidence_band, "stable");
  assert.equal(result.items[1]?.action, "analyze_segment_backlog");
}

function run() {
  testBuildReelsBrainSegmentPriorityQueueBlendsGenerationAndLearningNeeds();
  console.log("reelsBrainSegmentPriorityQueue.test: ok");
}

run();
