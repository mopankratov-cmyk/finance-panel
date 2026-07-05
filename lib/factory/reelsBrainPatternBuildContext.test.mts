import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPatternBuildContext,
  patternBuildFetchLimit,
  prioritizePatternSourceVideos,
} from "./reelsBrainPatternBuildContext";

test("buildPatternBuildContext derives focused output-ready bias from brief-bundle intent", () => {
  const context = buildPatternBuildContext({
    niche: "ru_toys",
    requestedLimit: 300,
    executionIntent: {
      mode: "brief_bundle_completion",
      focus_segment: "ru_toys × tiktok",
      field_focus: "visual_recipe",
      family_focus: "visual",
    },
  });

  assert.equal(context.focus_platform, "tiktok");
  assert.equal(context.execution_mode, "brief_bundle_completion");
  assert.equal(context.brief_bundle_biased, true);
  assert.equal(context.output_ready_biased, true);
  assert.equal(context.platform_biased, true);
  assert.equal(context.field_focus, "visual_recipe");
  assert.equal(context.family_focus, "visual");
});

test("patternBuildFetchLimit expands fetch window for output-ready rebuilds", () => {
  const context = buildPatternBuildContext({
    niche: "ru_clothing",
    requestedLimit: 200,
    executionIntent: {
      mode: "ship_ready_bundle_completion",
      focus_segment: "ru_clothing × instagram",
    },
  });

  assert.equal(patternBuildFetchLimit(200, context), 600);
});

test("prioritizePatternSourceVideos favors focused analyzed-rich rows for brief-bundle rebuilds", () => {
  const context = buildPatternBuildContext({
    niche: "ru_toys",
    requestedLimit: 100,
    executionIntent: {
      mode: "brief_bundle_completion",
      focus_segment: "ru_toys × tiktok",
      field_focus: "visual_recipe",
      family_focus: "visual",
    },
  });
  const rows = prioritizePatternSourceVideos([
    {
      id: 1,
      platform: "instagram",
      virality_score: 980,
      analyzed_full: null,
      hook_text: null,
      format_detected: null,
      caption: null,
    },
    {
      id: 2,
      platform: "tiktok",
      virality_score: 720,
      analyzed_full: {
        hook_type: "demo_review",
        structure_type: "demo",
        visual_recipe: "close-up hands",
        captions: true,
      },
      hook_text: "Смотри что внутри",
      format_detected: "demo",
      caption: "Показываю игрушку крупным планом",
    },
  ], context, 2);

  assert.equal(rows[0]?.id, 2);
});

test("prioritizePatternSourceVideos favors exact platform proof when exact-proof mode is active", () => {
  const context = buildPatternBuildContext({
    niche: "ru_cosmetics",
    requestedLimit: 100,
    sourceDiscoveryMode: "close_exact_proof",
    executionIntent: {
      mode: "support_primary_segment",
      focus_segment: "ru_cosmetics × instagram",
    },
  });
  const rows = prioritizePatternSourceVideos([
    {
      id: 1,
      platform: "youtube",
      virality_score: 1200,
      analyzed_full: { hook_type: "demo_review" },
    },
    {
      id: 2,
      platform: "instagram",
      virality_score: 650,
      analyzed_full: { hook_type: "demo_review" },
    },
  ], context, 2);

  assert.equal(rows[0]?.id, 2);
});

console.log("reelsBrainPatternBuildContext: passed");
