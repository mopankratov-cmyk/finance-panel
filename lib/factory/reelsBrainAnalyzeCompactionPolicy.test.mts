import test from "node:test";
import assert from "node:assert/strict";
import { parseAnalyzeExecutionIntent, tuneAnalyzeLaneByExecutionIntent } from "./reelsBrainAnalyzeCompactionPolicy";

test("tuneAnalyzeLaneByExecutionIntent deepens compaction for primary support segment", () => {
  const intent = parseAnalyzeExecutionIntent({
    mode: "support_primary_segment",
    task: "analyze",
    focus_segment: "ru_toys × tiktok",
    policy_mode: "primary",
    explanation: "primary support",
  });
  const result = tuneAnalyzeLaneByExecutionIntent({
    intent,
    lane: { niche: "ru_toys", platform: "tiktok", unanalyzed: 22 },
    analyzeLimit: 18,
    buildPatterns: false,
  });

  assert.equal(result.strategy, "support_primary_segment");
  assert.equal(result.build_patterns, true);
  assert.equal(result.focus_platform, "tiktok");
  assert.equal(result.pattern_limit, 360);
  assert.equal(result.analyze_limit, 10);
});

test("tuneAnalyzeLaneByExecutionIntent keeps research compaction wider", () => {
  const intent = parseAnalyzeExecutionIntent({
    mode: "explore_research_segment",
    task: "analyze",
    focus_segment: "ru_clothing × instagram",
    policy_mode: "research_only",
    explanation: "research",
  });
  const result = tuneAnalyzeLaneByExecutionIntent({
    intent,
    lane: { niche: "ru_clothing", platform: "instagram", unanalyzed: 30 },
    analyzeLimit: 8,
    buildPatterns: false,
  });

  assert.equal(result.strategy, "explore_research_segment");
  assert.equal(result.build_patterns, false);
  assert.equal(result.focus_platform, null);
  assert.equal(result.pattern_limit, 720);
  assert.equal(result.analyze_limit, 14);
});

test("tuneAnalyzeLaneByExecutionIntent focuses exact-proof compaction tighter than portfolio gap mode", () => {
  const intent = parseAnalyzeExecutionIntent({
    mode: "close_exact_segment_gap",
    task: "analyze",
    focus_segment: "ru_toys × instagram",
    policy_mode: "primary",
    explanation: "exact proof",
  });
  const result = tuneAnalyzeLaneByExecutionIntent({
    intent,
    lane: { niche: "ru_toys", platform: "instagram", unanalyzed: 20 },
    analyzeLimit: 18,
    buildPatterns: false,
  });

  assert.equal(result.strategy, "close_exact_segment_gap");
  assert.equal(result.build_patterns, true);
  assert.equal(result.focus_platform, "instagram");
  assert.equal(result.pattern_limit, 300);
  assert.equal(result.analyze_limit, 10);
});

test("tuneAnalyzeLaneByExecutionIntent tightens ship-ready compaction for high trust-gain upgrades", () => {
  const intent = parseAnalyzeExecutionIntent({
    mode: "ship_ready_bundle_completion",
    task: "analyze",
    focus_segment: "ru_clothing × instagram",
    policy_mode: "primary",
    explanation: "ship ready",
    projected_trust_gain_score: 31,
    projected_trust_gain_band: "high",
    unlocked_output: "publishable_visual_brief",
  });
  const result = tuneAnalyzeLaneByExecutionIntent({
    intent,
    lane: { niche: "ru_clothing", platform: "instagram", unanalyzed: 19 },
    analyzeLimit: 14,
    buildPatterns: false,
  });

  assert.equal(result.strategy, "ship_ready_bundle_completion");
  assert.equal(result.analyze_limit, 6);
  assert.equal(result.build_patterns, true);
  assert.equal(result.taxonomy_limit, 12);
  assert.equal(result.pattern_limit, 180);
});

console.log("reelsBrainAnalyzeCompactionPolicy: passed");
