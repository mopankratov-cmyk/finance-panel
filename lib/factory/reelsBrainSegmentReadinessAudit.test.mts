import assert from "node:assert/strict";
import { buildReelsBrainSegmentReadinessAudit } from "./reelsBrainSegmentReadinessAudit";

function testBuildReelsBrainSegmentReadinessAuditExplainsVerdicts() {
  const result = buildReelsBrainSegmentReadinessAudit({
    segmentGenerationPacks: {
      items: [
        {
          niche: "ru_toys",
          platform: "tiktok",
          label: "ru_toys × tiktok",
          readiness_score: 93,
          ready_for_generation: true,
          evidence_status: "high_trust",
          corpus_score: 88,
          market_score: 74,
          stable_pattern_count: 4,
          evidence_refs: 4,
          brief_title: "Toys brief",
          hypothesis_title: "Reveal hypothesis",
          action_title: "Scale toys",
          quality_gate: {
            status: "ready",
            min_trust_score: 82,
            min_corpus_score: 76,
            min_market_score: 58,
            min_stable_patterns: 2,
            min_evidence_refs: 2,
            blocked_reasons: [],
          },
        },
        {
          niche: "ru_cosmetics",
          platform: "instagram",
          label: "ru_cosmetics × instagram",
          readiness_score: 68,
          ready_for_generation: true,
          evidence_status: "validated",
          corpus_score: 59,
          market_score: 30,
          stable_pattern_count: 1,
          evidence_refs: 1,
          brief_title: "Beauty brief",
          quality_gate: {
            status: "needs_validation",
            min_trust_score: 66,
            min_corpus_score: 60,
            min_market_score: 34,
            min_stable_patterns: 1,
            min_evidence_refs: 1,
            blocked_reasons: ["корпус сегмента ещё недостаточно плотный"],
          },
        },
      ],
    },
  });

  assert.equal(result.summary.total, 2);
  assert.equal(result.summary.ship, 1);
  assert.equal(result.summary.validate, 1);
  assert.equal(result.items[0]?.verdict, "ship");
  assert.equal(result.items[0]?.gaps.trust_score, 0);
  assert.ok(result.items[0]?.strong_signals.includes("trust score уже проходит gate"));
  assert.equal(result.items[1]?.verdict, "validate");
  assert.equal(result.items[1]?.gaps.corpus_score, 1);
  assert.equal(result.items[1]?.blockers[0], "корпус сегмента ещё недостаточно плотный");
}

function run() {
  testBuildReelsBrainSegmentReadinessAuditExplainsVerdicts();
  console.log("reelsBrainSegmentReadinessAudit.test: ok");
}

run();
