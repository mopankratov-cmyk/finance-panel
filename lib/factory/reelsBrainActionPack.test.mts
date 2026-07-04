import assert from "node:assert/strict";
import { buildReelsBrainActionPack } from "./reelsBrainActionPack";

function testActionPackRanksScaleAndMarketProofAboveWatch() {
  const pack = buildReelsBrainActionPack([
    {
      id: "watch_1",
      title: "Watch pattern",
      op_score: 72,
      final_decision: "watch",
      confidence: "low",
      quality_gate: "experimental",
      warnings: ["Только A/B тест"],
      creative_brief: { hook: "hook 1", retention_mechanic: "proof", structure: "demo" },
      market_signal: { status: "weak", confidence: "low", winners: 0, total_posts: 2 },
    },
    {
      id: "scale_1",
      title: "Scale pattern",
      op_score: 90,
      final_decision: "scale",
      confidence: "high",
      quality_gate: "high_confidence",
      creative_brief: { hook: "hook 2", retention_mechanic: "open loop", structure: "demo" },
      market_signal: { status: "proven", confidence: "high", best_platform: "tiktok", winners: 4, total_posts: 5 },
    },
  ], 4);

  assert.ok(pack.primary);
  assert.equal(pack.primary?.pattern_id, "scale_1");
  assert.equal(pack.primary?.decision, "scale");
  assert.equal(pack.primary?.market_status, "proven");
  assert.equal(pack.alternatives.length, 1);
  assert.equal(pack.summary.scale, 1);
  assert.equal(pack.summary.watch, 1);
}

function run() {
  testActionPackRanksScaleAndMarketProofAboveWatch();
  console.log("reelsBrainActionPack.test: ok");
}

run();
