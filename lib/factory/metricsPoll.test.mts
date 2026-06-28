import { equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { metricsPostBody, normalizeMetricsSnapshot, summarizeMetricsPoll } from "./metricsPoll";

{
  const result = normalizeMetricsSnapshot({
    recipe_id: 42,
    platform: "Instagram",
    views: "1200.9",
    completion: 54,
    hook_rate: 0.7,
    ctr_card: 3.5,
    saves: "8",
    posted_at: "2026-06-28T12:00:00Z",
  });

  ok(result.snapshot, "valid metrics normalize");
  equal(result.snapshot?.recipe_id, 42, "recipe id is numeric");
  equal(result.snapshot?.platform, "instagram", "platform is normalized");
  equal(result.snapshot?.views, 1200, "views are non-negative integers");
  equal(result.snapshot?.watch_rate, 0.54, "watch_rate falls back to completion and normalizes percent");
  equal(result.snapshot?.hook_rate, 0.7, "hook_rate is preserved as fraction");
  equal(result.snapshot?.ctr, 0.035, "ctr_card is normalized as ctr");
  equal(result.snapshot?.saves, 8, "saves are non-negative integers");
  ok(result.snapshot?.warnings.includes("watch_rate derived from available retention metric"), "derived watch_rate is explained");
}

{
  const summary = summarizeMetricsPoll([
    { recipe_id: 1, views: 100, watch_rate: 0.4 },
    { recipe_id: 2 },
    { views: 10 },
  ]);

  equal(summary.ready.length, 1, "only complete metric rows are ready");
  equal(summary.skipped.length, 2, "incomplete rows are skipped fail-open");
  equal(summary.skipped[0]?.reason, "missing_views", "missing views reason is explicit");
  equal(summary.skipped[1]?.reason, "missing_recipe_id", "missing recipe reason is explicit");
}

{
  const body = metricsPostBody({
    recipe_id: 7,
    platform: "tiktok",
    views: 500,
    watch_rate: 0.31,
    hook_rate: 0.6,
    hold_rate: null,
    completion: null,
    ctr: null,
    saves: null,
    posted_at: "2026-06-28T12:00:00Z",
    source: "test",
    warnings: [],
  });

  equal(body.recipe_id, 7, "post body keeps recipe id");
  equal(body.watch_rate, 0.31, "post body sends watch_rate to post-metrics");
  equal(body.hook_rate, 0.6, "post body keeps hook_rate for diagnostics/future schema");
}

{
  const route = readFileSync("app/api/factory/jobs/metrics-poll/route.ts", "utf8");
  ok(/\/api\/factory\/post-metrics/.test(route), "metrics poll forwards snapshots into post-metrics");
  ok(/no metrics available; batch remains fail-open/.test(route), "metrics poll is fail-open when no data exists");
  ok(/CRON_SECRET/.test(route), "metrics poll job supports cron auth");
}

console.log("metricsPoll: passed");
