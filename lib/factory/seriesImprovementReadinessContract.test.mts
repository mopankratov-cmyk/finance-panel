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

const improvement = readFileSync("lib/factory/improvementLoop.ts", "utf8");
const learning = readFileSync("app/api/factory/learning/route.ts", "utf8");
const scripts = readFileSync("app/api/factory/scripts/route.ts", "utf8");
const batch = readFileSync("app/api/factory/batch/route.ts", "utf8");
const graphRun = readFileSync("app/api/factory/graph-run/route.ts", "utf8");
const postMetrics = readFileSync("app/api/factory/post-metrics/route.ts", "utf8");
const studio = readFileSync("public/inferno/studio.html", "utf8");
const seriesReadiness = readFileSync("app/api/factory/series-readiness/route.ts", "utf8");

ok(/Number\(options\?\.\s*target_runs\)\s*\|\|\s*50/.test(improvement), "improvement loop defaults to 50-run target");
ok(/Number\(options\?\.\s*batch_size\)\s*\|\|\s*5/.test(improvement), "improvement loop defaults to 5-run batches");
ok(/axis_insights: axisInsights/.test(improvement), "improvement loop keeps experiment-axis memory");
ok(/quality_wins: number;/.test(improvement), "improvement loop separates quality wins from market wins");
ok(/dominant_warning_reason: string \| null;/.test(improvement), "improvement loop keeps warning memory");
ok(/b\.market_wins - a\.market_wins \|\| b\.winner_rate - a\.winner_rate/.test(improvement), "patterns prioritize market wins before quality wins");
ok(/export interface ImprovementNextBatchGate/.test(improvement), "improvement loop exposes next-batch readiness gate");
ok(/сначала закрыть market feedback/.test(improvement), "next-batch gate requires feedback before the next five");
ok(/feedback_queue: feedbackQueue/.test(improvement), "improvement loop exposes latest-batch feedback queue");
ok(/series_state: seriesState/.test(improvement), "improvement loop exposes 50-run series state");
ok(/series_start_at: seriesStartAt/.test(improvement), "improvement loop exposes active series window");
ok(/batch_run_id: string \| null;/.test(improvement), "improvement loop exposes actual batch ids");
ok(/batch_run_id: dominant\(chunk, \(row\) => row\.batch_run_id\)/.test(improvement), "improvement loop maps latest batch to actual batch id");
ok(/String\(row\.status \|\| ""\)\.toLowerCase\(\) !== "draft"/.test(improvement), "improvement loop does not treat prepared drafts as completed runs");

ok(/const seriesAfter = \(sp\.get\("series_after"\) \|\| ""\)\.trim\(\) \|\| null;/.test(learning), "learning API reads active series window");
ok(/loadImprovementSnapshot\(db, \{ niche: nicheF \|\| null, target_runs: 50, batch_size: 5, series_after: seriesAfter \}\)/.test(learning), "learning API exposes 50-run improvement snapshot");
ok(/batchPlanHintFor/.test(scripts) && /batch_plan: batchPlan/.test(scripts), "script generation receives and returns batch plan");

ok(/const requireFullBatch = b\.require_full_batch === true;/.test(batch), "batch can require full next-five launch");
ok(/const requireLearningGate = b\.require_learning_gate === true;/.test(batch), "batch can require learning-gated next-five launch");
ok(/const seriesAfter = String\(b\.series_after \|\| ""\)\.trim\(\) \|\| null;/.test(batch), "batch accepts active series window");
ok(/if \(requireFullBatch && !dryRun && !preflight\.ready\)/.test(batch), "batch blocks partial guarded launches");
ok(/if \(requireLearningGate && !dryRun && !learningGate\.ready\)/.test(batch), "batch blocks next-five launches without enough feedback");
ok(/batch_run_id: batchRunId/.test(batch), "batch returns a traceable batch id");
ok(/selected_recipes: selectedWithBatchMeta\(enqueued\)/.test(batch), "batch returns selected recipe metadata");
ok(/const selectedById = new Map\(selectedRecipes\.map/.test(batch), "batch metadata follows planned recipe id order");
ok(/async function enqueueGraphRun\(db: any, rid: number, meta: \{ batch_run_id: string; batch_role: string; change_axis: string \}\)/.test(batch), "batch enqueues graph-run with traceable metadata");
ok(/plan\.batch_run_id = meta\.batch_run_id/.test(batch), "batch persists batch id into run_plan");
ok(/plan\.batch_role = meta\.batch_role === "control" \|\| meta\.batch_role === "experiment"/.test(batch), "batch persists sanitized batch role into run_plan");
ok(/plan\.change_axis = \["none", "hook_angle", "proof_density", "cta_shape", "format"\]\.includes\(meta\.change_axis\)/.test(batch), "batch persists sanitized change axis into run_plan");
ok(/enqueueGraphRun\(db, rid, \{ batch_run_id: batchRunId, batch_role: batchMeta\.batch_role, change_axis: batchMeta\.change_axis \}\)/.test(batch), "batch passes metadata to fast enqueue");

ok(/batch_run_id: plan\?\.batch_run_id \|\| null/.test(graphRun), "graph-run status exposes batch id");
ok(/forwarded\s*=\s*res\.ok\s*&&\s*payload\?\.ok\s*===\s*true/.test(postMetrics), "market feedback can feed winners loop");
ok(/ready_to_launch_next/.test(seriesReadiness), "series readiness exposes next-launch readiness");
ok(/require_learning_gate: true/.test(seriesReadiness), "series readiness recommends learning-gated batch launch");
ok(/series_after: snapshot\.series_start_at/.test(seriesReadiness), "series readiness recommends launch inside the active series window");
ok(/feedback_queue_count: snapshot\.feedback_queue\.length/.test(seriesReadiness), "series readiness reports feedback queue coverage");

ok(/series_after:seriesStart/.test(studio), "Studio launches server-gated next-five preflight inside the active series window");
ok(/disabled:!nextGate\.ready/.test(studio), "Studio blocks next-five launch until the learning gate is ready");
ok(/payload\.require_learning_gate=true/.test(studio), "Studio forwards learning gate to batch API");
ok(/payload\.series_after=opts\.series_after/.test(studio), "Studio forwards active series window to batch API");
ok(/imp\.feedback_queue&&imp\.feedback_queue\.length/.test(studio), "Studio uses latest-batch feedback queue from snapshot");
ok(/const series=imp\.series_state/.test(studio), "Studio uses 50-run series state from snapshot");
ok(/x\.batch_role\|\|"role\?"/.test(studio), "Studio shows batch role for selected recipes");
ok(/api\("\/series-readiness"/.test(studio), "Studio exposes read-only series readiness check");
ok(/series_after="\+encodeURIComponent\(seriesStart\)/.test(studio), "Studio forwards active series window to readiness check");
ok(/Очередь обратной связи/.test(studio), "Studio supports market feedback queue");
ok(/Проверить прогресс batch/.test(studio), "Studio can check launched batch progress");

if (failed) process.exit(1);
console.log(`seriesImprovementReadinessContract: ${passed} passed, ${failed} failed`);
