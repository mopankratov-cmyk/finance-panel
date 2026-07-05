import assert from "node:assert/strict";
import { buildReelsBrainDecisionPack } from "./reelsBrainDecisionPack";

function testDecisionPackBuildsPrimaryAndAlternatives() {
  const pack = buildReelsBrainDecisionPack({
    niche: "ru_toys",
    platform: "tiktok",
    productType: "детская игрушка",
    trustDecision: {
      selected_scope: "platform",
      selected_platform: "tiktok",
      allow_primary_use: true,
      recommended_mode: "primary",
      reasons: ["tiktok trust 84% · ready"],
      trust: {
        score: 84,
        status: "ready",
        confidence: "high",
        why_ready: ["разобрано достаточно видео"],
        why_not_yet: [],
      },
    },
    patterns: [
      {
        pattern_id: "p-best",
        hook_label: "Смотри что произошло",
        structure_type: "demo",
        structure_label: "demo",
        retention_mechanism: "open_loop",
        retention_label: "open loop",
        quality_label: "generator_ready",
        strength_score: 78,
        frequency: 18,
        relevance_score: 82,
        quality_score: 88,
        avg_views: 320000,
      },
      {
        pattern_id: "p-alt",
        hook_label: "Я не ожидала",
        structure_type: "review",
        structure_label: "review",
        retention_mechanism: "proof",
        retention_label: "proof",
        quality_label: "generator_ready",
        strength_score: 61,
        frequency: 10,
        relevance_score: 70,
        quality_score: 72,
        avg_views: 110000,
      },
    ],
    limit: 3,
  });

  assert.ok(pack.primary);
  assert.equal(pack.primary?.pattern_id, "p-best");
  assert.equal(pack.primary?.source, "reels_brain_best_pattern");
  assert.equal(pack.alternatives.length, 1);
  assert.equal(pack.alternatives[0]?.pattern_id, "p-alt");
  assert.equal(pack.decision_pack.options_total, 2);
  assert.equal(pack.decision_pack.recommended_mode, "primary");
  assert.equal(pack.primary?.quality_gate?.status, "needs_validation");
  assert.equal(pack.primary?.quality_gate?.exact_segment_ready, false);
  assert.deepEqual(pack.primary?.quality_gate?.allowed_generation_modes, ["control_ready", "brief_only"]);
  assert.equal(pack.decision_pack.quality_gate?.source, "legacy_decision_pack");
  assert.ok(pack.primary?.creative_brief.hook.includes("Смотри"));
}

function run() {
  testDecisionPackBuildsPrimaryAndAlternatives();
  console.log("reelsBrainDecisionPack.test: ok");
}

run();
