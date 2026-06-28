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

const source = readFileSync("lib/factory/improvementLoop.ts", "utf8");

ok(/export interface ImprovementRun/.test(source), "improvement loop defines run contract");
ok(/export interface ImprovementBatch/.test(source), "improvement loop defines batch contract");
ok(/export interface ImprovementAxisInsight/.test(source), "improvement loop defines experiment axis contract");
ok(/export interface ImprovementSnapshot/.test(source), "improvement loop defines snapshot contract");
ok(/series_start_at: string \| null;/.test(source), "improvement loop exposes current series window start");
ok(/export interface ImprovementSeriesState/.test(source), "improvement loop defines series-state contract");
ok(/export interface ImprovementBatchPlan/.test(source), "improvement loop defines batch plan contract");
ok(/export interface ImprovementNextBatchGate/.test(source), "improvement loop defines next-batch gate contract");
ok(/function classifyVerdict/.test(source), "improvement loop classifies winner\/salvageable\/loser");
ok(/function buildBatches/.test(source), "improvement loop builds 5-run batches");
ok(/function buildAxisInsights/.test(source), "improvement loop builds axis-level learning memory");
ok(/export function buildBatchPlan/.test(source), "improvement loop builds next batch plan");
ok(/market_views: number \| null;/.test(source), "improvement loop tracks market views per run");
ok(/quality_wins: number;/.test(source), "improvement loop separates internal quality wins from market wins");
ok(/warning_reason: string;/.test(source), "improvement loop tracks warning reason per run");
ok(/dominant_warning_reason: string \| null;/.test(source), "improvement loop exposes dominant warning reason on aggregates");
ok(/import \{ normalizeWarningReason \} from "\.\/observability";/.test(source), "improvement loop reuses shared warning normalization");
ok(/warnings\.map\(\(v\) => normalizeWarningReason\(toText\(v, 120\)\)\)/.test(source), "improvement loop normalizes warning reasons before learning aggregation");
ok(/feedback_status: "winner" \| "approved" \| "rejected" \| "none";/.test(source), "improvement loop tracks explicit feedback status");
ok(/batch_run_id: string \| null;/.test(source), "improvement loop exposes batch run ids");
ok(/batch_role: "control" \| "experiment" \| "none";/.test(source), "improvement loop tracks batch role");
ok(/change_axis: "none" \| "hook_angle" \| "proof_density" \| "cta_shape" \| "format";/.test(source), "improvement loop tracks change axis");
ok(/function batchRunIdFromPlan/.test(source), "improvement loop extracts batch id from run plan");
ok(/function runStartedAtFromPlan/.test(source), "improvement loop extracts actual run start from execution log");
ok(/function batchRoleFromPlan/.test(source), "improvement loop extracts batch role from run plan");
ok(/function changeAxisFromPlan/.test(source), "improvement loop extracts experiment axis from run plan");
ok(/batch_run_id: batchRunIdFromPlan\(row\.run_plan\)/.test(source), "improvement run carries batch id from graph-run plan");
ok(/batch_role: assetMeta\?\.batch_role \|\| batchRoleFromPlan\(row\.run_plan\)/.test(source), "improvement run falls back to graph-run batch role");
ok(/change_axis: assetMeta\?\.change_axis \|\| changeAxisFromPlan\(row\.run_plan\)/.test(source), "improvement run falls back to graph-run change axis");
ok(/batch_run_id: dominant\(chunk, \(row\) => row\.batch_run_id\)/.test(source), "improvement batch aggregates dominant batch id");
ok(/\.from\("post_metrics"\)/.test(source), "improvement loop reads post metrics");
ok(/\.from\("cf_signals"\)/.test(source), "improvement loop reads cf_signals feedback");
ok(/select\("url,is_winner,winner_at,analysis"\)/.test(source), "improvement loop reads asset analysis metadata");
ok(/top_patterns: topPatterns/.test(source), "improvement snapshot exposes top patterns");
ok(/feedback_queue: feedbackQueue/.test(source), "improvement snapshot exposes latest-batch feedback queue");
ok(/series_start_at: seriesStartAt/.test(source), "improvement snapshot carries series window start");
ok(/axis_insights: axisInsights/.test(source), "improvement snapshot exposes axis insights");
ok(/series_state: seriesState/.test(source), "improvement snapshot exposes 50-run series state");
ok(/next_actions: nextActions/.test(source), "improvement snapshot exposes next actions");
ok(/next_batch_gate: nextBatchGate/.test(source), "improvement snapshot exposes next batch gate");
ok(/batch_plan: analyzedRuns.length \? buildBatchPlan/.test(source), "improvement snapshot exposes batch plan");
ok(/УЛУЧШЕНИЕ ПО СЕРИЯМ/.test(source), "improvement loop renders batch improvement hints");
ok(/BATCH PLAN НА СЛЕДУЮЩУЮ ПЯТЁРКУ/.test(source), "improvement loop renders batch plan hint");
ok(/лучшая ось эксперимента сейчас/.test(source), "improvement loop renders best experiment axis hint");
ok(/market_wins/.test(source), "improvement loop exposes market-backed batch wins");
ok(/b\.market_wins - a\.market_wins \|\| b\.winner_rate - a\.winner_rate/.test(source), "top patterns prioritize market wins over internal winner rate");
ok(/Number\(options\?\.\s*target_runs\)\s*\|\|\s*50/.test(source), "improvement loop defaults to 50-run target");
ok(/Number\(options\?\.\s*batch_size\)\s*\|\|\s*5/.test(source), "improvement loop defaults to 5-run batches");
ok(/buildNextBatchGate/.test(source), "improvement loop gates next-five launch readiness");
ok(/сначала закрыть market feedback/.test(source), "next-batch gate requires feedback before continuing");
ok(/function buildFeedbackQueue/.test(source), "improvement loop builds a latest-batch feedback queue");
ok(/Number\(hasExplicitFeedback\(a\)\) - Number\(hasExplicitFeedback\(b\)\)/.test(source), "feedback queue prioritizes runs without feedback");
ok(/function buildSeriesState/.test(source), "improvement loop builds 50-run series state");
ok(/remaining_batches: Math\.ceil\(remainingRuns \/ batchSize\)/.test(source), "series state tracks remaining batches");
ok(/series_after\?: string \| null;/.test(source), "improvement loop accepts a series window filter");
ok(/\.filter\(\(row\) => !seriesStartAt \|\| String\(runStartedAtFromPlan\(row\.run_plan\) \|\| row\.created_at \|\| ""\) >= seriesStartAt\)/.test(source), "improvement loop filters in-memory rows by actual run start window");
ok(/\.filter\(\(row\) => String\(row\.status \|\| ""\)\.toLowerCase\(\) !== "draft"\)/.test(source), "improvement loop excludes unlaunched draft recipes");
ok(/\.order\(seriesStartAt \? "updated_at" : "created_at"/.test(source), "improvement loop fetches recently updated rows for active series windows");

if (failed) process.exit(1);
console.log(`improvementLoop: ${passed} passed, ${failed} failed`);
