import assert from "node:assert/strict";
import test from "node:test";
import { buildReelsBrainCronExecutionIntent } from "./reelsBrainCronExecutionIntent";

test("buildReelsBrainCronExecutionIntent narrows bulk execution for primary support segments", () => {
  const result = buildReelsBrainCronExecutionIntent({
    task: "bulk",
    nextTick: {
      task: "collect_support_for_decision_segment",
      priority_segment: {
        label: "ru_toys × tiktok",
      },
      generation_policy: {
        policy_mode: "primary",
      },
    },
  });

  assert.equal(result.mode, "support_primary_segment");
  assert.equal(result.focus_segment, "ru_toys × tiktok");
  assert.equal(result.bulk_overrides?.max_lanes, 1);
  assert.equal(result.bulk_overrides?.providers_per_lane, 1);
  assert.equal(result.bulk_overrides?.hours, 48);
});

test("buildReelsBrainCronExecutionIntent keeps research collection wider", () => {
  const result = buildReelsBrainCronExecutionIntent({
    task: "bulk",
    nextTick: {
      task: "collect_smart_batch",
      priority_segment: {
        label: "ru_clothing × instagram",
      },
      generation_policy: {
        policy_mode: "research_only",
      },
    },
  });

  assert.equal(result.mode, "explore_research_segment");
  assert.equal(result.bulk_overrides?.providers_per_lane, 2);
  assert.equal(result.bulk_overrides?.query_variants_per_lane, 2);
  assert.equal(result.bulk_overrides?.hours, 96);
});

test("buildReelsBrainCronExecutionIntent narrows research collection when pattern gain gets expensive", () => {
  const result = buildReelsBrainCronExecutionIntent({
    task: "bulk",
    nextTick: {
      task: "collect_smart_batch",
      priority_segment: {
        label: "ru_clothing × instagram",
      },
      generation_policy: {
        policy_mode: "research_only",
      },
      learning_economics: {
        pattern_gain_cost_trend: "more_expensive",
        weak_pattern_gain: true,
      },
    },
  });

  assert.equal(result.mode, "explore_research_segment");
  assert.equal(result.bulk_overrides?.providers_per_lane, 1);
  assert.equal(result.bulk_overrides?.query_variants_per_lane, 1);
  assert.equal(result.bulk_overrides?.max_cost_units, 6);
  assert.equal(result.bulk_overrides?.hours, 48);
});

test("buildReelsBrainCronExecutionIntent pushes analyze toward compaction when pattern gain is weak", () => {
  const result = buildReelsBrainCronExecutionIntent({
    task: "analyze",
    nextTick: {
      task: "analyze_backlog",
      priority_segment: {
        label: "ru_cosmetics × youtube",
      },
      learning_economics: {
        pattern_gain_cost_trend: "more_expensive",
        weak_pattern_gain: true,
      },
    },
  });

  assert.equal(result.mode, "generic_analyze");
  assert.equal(result.analyze_overrides?.build_patterns, true);
  assert.equal(result.analyze_overrides?.max_lanes, 3);
  assert.equal(result.analyze_overrides?.limit, 16);
});

test("buildReelsBrainCronExecutionIntent forces build_patterns when corpus target is already reached", () => {
  const result = buildReelsBrainCronExecutionIntent({
    task: "analyze",
    nextTick: {
      task: "build_patterns",
      priority_segment: {
        label: "ru_cosmetics × youtube",
      },
    },
  });

  assert.equal(result.mode, "pattern_compaction");
  assert.equal(result.analyze_overrides?.build_patterns, true);
  assert.equal(result.analyze_overrides?.max_lanes, 2);
});

console.log("reelsBrainCronExecutionIntent: passed");
