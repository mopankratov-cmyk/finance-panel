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
const studio = readFileSync("public/inferno/studio.html", "utf8");

ok(/warnings:\s*string\[\]\s*=\s*\[\]/.test(postMetrics), "post-metrics returns warning context");
ok(/Math\.max\(0, Math\.floor\(Number\(b\.views\)/.test(postMetrics), "post-metrics rejects negative or fractional view counts");
ok(/Math\.min\(1, Math\.max\(0, n\)\)/.test(postMetrics), "post-metrics clamps rate metrics to 0..1");
ok(/forwarded\s*=\s*res\.ok\s*&&\s*payload\?\.ok\s*===\s*true/.test(postMetrics), "post-metrics only reports forwarded after winners success");
ok(/winners forward:/.test(postMetrics), "post-metrics warns when winner forward fails");
ok(/let outputUrl: string \| null = null;/.test(postMetrics) && /select\("output_url,status,run_plan"\)/.test(postMetrics), "post-metrics reads output url and recipe status before marking posted");
ok(/if \(\(metricsSaved \|\| forwarded\) && outputUrl && recipeStatus !== "running"\)/.test(postMetrics) && /\.neq\("status", "running"\)/.test(postMetrics) && /status_marked: statusMarked/.test(postMetrics), "post-metrics marks posted only for completed recipes with output_url");
ok(/recipe status not marked posted: missing output_url/.test(postMetrics) && /recipe status not marked posted: recipe is still running/.test(postMetrics), "post-metrics warns when metrics are accepted but posted status is unsafe");
ok(/post_metrics недоступна/.test(abRank), "ab-rank fails open when post_metrics is unavailable");
ok(/node_recipes недоступна/.test(abRank), "ab-rank fails open when node_recipes lookup is unavailable");
ok(/d\.warnings&&d\.warnings\.length\?"✓ метрики · предупр\."/.test(studio), "Studio shows warning when metrics saved but winner forward did not complete");
ok(/d\.status_marked\?"✓ опубликован · метрики записаны"/.test(studio) && /r\.status="posted"; _libCache=null; if\(S\.screen==="library"\)screenLibrary\(document\.getElementById\("screen"\)\);/.test(studio), "Studio reflects posted status after post-metrics accepts a market signal");

if (failed) process.exit(1);
console.log(`marketFeedback: ${passed} passed, ${failed} failed`);
