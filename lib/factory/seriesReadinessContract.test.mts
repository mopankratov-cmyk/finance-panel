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

const route = readFileSync("app/api/factory/series-readiness/route.ts", "utf8");

ok(/const seriesAfter = \(sp\.get\("series_after"\) \|\| ""\)\.trim\(\) \|\| null;/.test(route), "series readiness reads optional series window");
ok(/loadImprovementSnapshot\(db, \{ niche, target_runs: targetRuns, batch_size: batchSize, series_after: seriesAfter \}\)/.test(route), "series readiness reads improvement snapshot");
ok(/ready_to_launch_next/.test(route), "series readiness returns launch readiness");
ok(/snapshot\.series_state\.target_met/.test(route), "series readiness blocks after 50-run target is met");
ok(/!snapshot\.next_batch_gate\.ready/.test(route), "series readiness respects next-batch gate");
ok(/require_full_batch: true/.test(route), "series readiness recommends full-batch guard");
ok(/require_learning_gate: true/.test(route), "series readiness recommends learning gate guard");
ok(/auto_preflight: true/.test(route), "series readiness recommends auto preflight");
ok(/series_after: snapshot\.series_start_at/.test(route), "series readiness carries series window into recommended request");
ok(/series_start_at: snapshot\.series_start_at/.test(route), "series readiness exposes current series window");
ok(/feedback_queue_count: snapshot\.feedback_queue\.length/.test(route), "series readiness exposes feedback queue count");
ok(/Cache-Control": "no-store"/.test(route), "series readiness is uncached");
ok(/series-readiness crash/.test(route), "series readiness has JSON crash fallback");

if (failed) process.exit(1);
console.log(`seriesReadinessContract: ${passed} passed, ${failed} failed`);
