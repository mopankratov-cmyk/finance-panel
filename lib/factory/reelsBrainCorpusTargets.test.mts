import assert from "node:assert/strict";
import test from "node:test";
import {
  corpusAutomationPressure,
  corpusExecutionPlan,
  corpusProgress,
  corpusStage,
  corpusTargetByNiche,
  corpusTargetByPlatform,
  REELS_BRAIN_CORPUS_TARGET_TOTAL,
} from "./reelsBrainCorpusTargets";

test("corpusTargetByPlatform splits 10k across core networks", () => {
  const targets = corpusTargetByPlatform();
  assert.equal(targets.tiktok, 4000);
  assert.equal(targets.instagram, 3500);
  assert.equal(targets.youtube, 2500);
  assert.equal(targets.tiktok + targets.instagram + targets.youtube, REELS_BRAIN_CORPUS_TARGET_TOTAL);
});

test("corpusTargetByNiche spreads total target across active niches", () => {
  const targets = corpusTargetByNiche(["toys", "clothing", "cosmetics", "default"], 10000);
  assert.equal(targets.toys, 2500);
  assert.equal(targets.default, 2500);
});

test("corpusProgress and corpusStage describe gap to 10k", () => {
  const progress = corpusProgress({ current: 300, target: 10000 });
  assert.equal(progress.gap, 9700);
  assert.equal(progress.progress_pct, 3);
  const stage = corpusStage(300);
  assert.equal(stage.stage_key, "stage_2");
  assert.equal(stage.remaining_to_stage, 1200);
});

test("corpusAutomationPressure gets more aggressive when corpus is tiny", () => {
  const early = corpusAutomationPressure({ mode: "daily", currentVideos: 30, targetVideos: 4000 });
  const late = corpusAutomationPressure({ mode: "daily", currentVideos: 3200, targetVideos: 4000 });
  assert.equal(early.query_count, 3);
  assert.equal(early.source_limit, 24);
  assert.equal(late.query_count, 2);
  assert.equal(late.source_limit, 14);
});

test("corpusExecutionPlan computes daily and weekly intake quotas", () => {
  const plan = corpusExecutionPlan({
    currentTotal: 1000,
    targetTotal: 10000,
    horizonDays: 50,
    platforms: [
      { platform: "tiktok", current: 300, target: 4000 },
      { platform: "instagram", current: 400, target: 3500 },
      { platform: "youtube", current: 300, target: 2500 },
    ],
    niches: [
      { niche: "toys", current: 500, target: 2500 },
      { niche: "clothing", current: 250, target: 2500 },
    ],
  });
  assert.equal(plan.daily_required, 180);
  assert.equal(plan.weekly_required, 1260);
  assert.equal(plan.by_platform.find((row) => row.platform === "tiktok")?.daily_required, 74);
  assert.equal(plan.by_niche.find((row) => row.niche === "toys")?.weekly_required, 286);
});
