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
      rebuild_context: {
        execution_mode: "brief_bundle_completion",
        focus_platform: "tiktok",
        brief_bundle_biased: true,
        output_ready_biased: true,
        source_videos: 240,
      },
      rebuild_alignment: {
        status: "aligned",
        score: 42,
        reasons: ["память пересобиралась с platform focus на tiktok"],
      },
      trust: {
        score: 84,
        status: "ready",
        confidence: "high",
        audio_support: {
          score: 78,
          status: "ready",
          confidence: "high",
          with_audio: 42,
          with_audio_rate: 70,
          with_transcript: 31,
          with_transcript_rate: 51,
          feature_depth: {
            pause_map_ready: 18,
            pause_map_ready_rate: 43,
            pacing_ready: 20,
            pacing_ready_rate: 48,
            beat_hint_ready: 16,
            beat_hint_ready_rate: 38,
          },
          why_ready: ["voice/transcript слой уже плотный"],
          why_not_yet: [],
          note: "Voice/audio evidence уже пригоден для генерации.",
        },
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
  assert.equal(pack.primary?.evidence?.trust_decision?.rebuild_alignment?.status, "aligned");
  assert.equal(pack.primary?.evidence?.trust_decision?.audio_support?.status, "ready");
  assert.equal(pack.decision_pack.audio_support?.status, "ready");
  assert.match(String(pack.decision_pack.audio_note), /voice\/audio evidence/i);
  assert.equal(pack.decision_pack.rebuild_alignment?.status, "aligned");
  assert.match(String(pack.decision_pack.memory_note), /пересобиралась под близкий output context/i);
}

function run() {
  testDecisionPackBuildsPrimaryAndAlternatives();
  console.log("reelsBrainDecisionPack.test: ok");
}

run();
