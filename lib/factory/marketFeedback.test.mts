import { readFileSync } from "node:fs";

let passed = 0;
let failed = 0;

function ok(cond: boolean, msg: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", msg);
  }
}

const postMetrics = readFileSync("app/api/factory/post-metrics/route.ts", "utf8");
const abRank = readFileSync("app/api/factory/ab-rank/route.ts", "utf8");
const winners = readFileSync("app/api/factory/winners/route.ts", "utf8");
const studio = readFileSync("public/inferno/studio.html", "utf8");

ok(/warnings:\s*string\[\]\s*=\s*\[\]/.test(postMetrics), "post-metrics returns warning context");
ok(/Math\.max\(0, Math\.floor\(Number\(b\.views\)/.test(postMetrics), "post-metrics rejects negative or fractional view counts");
ok(/Math\.min\(1, Math\.max\(0, n\)\)/.test(postMetrics), "post-metrics clamps rate metrics to 0..1");
ok(/сначала проверяем рецепт/.test(postMetrics) && /рецепт не найден/.test(postMetrics) && /status: 404/.test(postMetrics), "post-metrics verifies recipe existence before writing market metrics");
ok(/forwarded\s*=\s*res\.ok\s*&&\s*payload\?\.ok\s*===\s*true/.test(postMetrics), "post-metrics only reports forwarded after winners success");
ok(/winners forward:/.test(postMetrics), "post-metrics warns when winner forward fails");
ok(/let outputUrl: string \| null = null;/.test(postMetrics) && /select\("output_url,status,run_plan"\)/.test(postMetrics) && /recipePlan = rec\?\.run_plan/.test(postMetrics), "post-metrics reads output url, status, and run plan before marking posted");
ok(/if \(\(metricsSaved \|\| forwarded\) && outputUrl && recipeStatus !== "running"\)/.test(postMetrics) && /\.neq\("status", "running"\)/.test(postMetrics) && /status_marked: statusMarked/.test(postMetrics), "post-metrics marks posted only for completed recipes with output_url");
ok(/recipe status not marked posted: missing output_url/.test(postMetrics) && /recipe status not marked posted: recipe is still running/.test(postMetrics), "post-metrics warns when metrics are accepted but posted status is unsafe");
ok(/const platform = \(b\.platform \|\| "TikTok"\)/.test(postMetrics) && /const watchRate = rateOrNull\(b\.watch_rate\)/.test(postMetrics) && /const ctrCard = rateOrNull\(b\.ctr\)/.test(postMetrics) && /const saves = countOrNull\(b\.saves\)/.test(postMetrics), "post-metrics normalizes the full market signal once");
ok(/platform,[\s\S]*watch_rate: watchRate,[\s\S]*ctr_card: ctrCard,[\s\S]*saves,[\s\S]*posted_at: postedAt/.test(postMetrics), "post-metrics forwards the full market signal into winners");
ok(/learnings\.market_signal = \{[\s\S]*platform:[\s\S]*views:[\s\S]*watch_rate:[\s\S]*ctr_card:[\s\S]*saves:[\s\S]*posted_at:/.test(winners), "winners persists market_signal in winner_learnings");
ok(/post_metrics недоступна/.test(abRank), "ab-rank fails open when post_metrics is unavailable");
ok(/node_recipes недоступна/.test(abRank), "ab-rank fails open when node_recipes lookup is unavailable");
ok(/const minWinnerViews = Math\.max\(0, Number\(sp\.get\("min_winner_views"\) \|\| 100\)/.test(abRank) && /rankVariants\(metrics, \{ minWinnerViews \}\)/.test(abRank) && /min_winner_views: minWinnerViews/.test(abRank), "ab-rank exposes a conservative market-winner threshold");
ok(/const review = winners\.map\(\(w\) => w\.recipe_id\);/.test(abRank) && /const hold = losers\.map\(\(l\) => l\.recipe_id\);/.test(abRank), "ab-rank exposes manual review and hold buckets");
ok(/scale: review,/.test(abRank) && /kill: hold,/.test(abRank), "ab-rank keeps legacy aliases without changing read-only semantics");
ok(/Авто-скейл выключен/.test(abRank), "ab-rank recommendation copy is explicitly read-only");
ok(/d\.warnings&&d\.warnings\.length\?"✓ метрики · предупр\."/.test(studio), "Studio shows warning when metrics saved but winner forward did not complete");
ok(/d\.status_marked\?"✓ опубликован · метрики записаны"/.test(studio) && /r\.status="posted"; _libCache=null; if\(S\.screen==="library"\)screenLibrary\(document\.getElementById\("screen"\)\);/.test(studio), "Studio reflects posted status after post-metrics accepts a market signal");
ok(/const canEnterMetrics=!!r\.output_url\|\|r\.status==="posted";/.test(studio) && /canEnterMetrics\?el\("div",\{style:"margin-top:8px;display:flex;gap:5px;align-items:center;"/.test(studio), "Studio only shows market metrics input after a recipe has an output video");

if (failed) process.exit(1);
console.log(`marketFeedback: ${passed} passed, ${failed} failed`);
