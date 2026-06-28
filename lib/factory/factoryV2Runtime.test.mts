import fs from "node:fs";
import { buildRunIdempotencyKey, budgetGuard, classifyDlqAction, planNextSeriesBatch, shouldPromoteWinner, workerHandoffPayload } from "./factoryV2Runtime";

function ok(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const nodes = [{ ordinal: 0, tool: "seedance", prompt: "a", asset_url: "https://cdn/a.png", params: { image_url: "https://cdn/a.png", lane: "product" } }];
const keyA = buildRunIdempotencyKey(1, nodes as any);
const keyB = buildRunIdempotencyKey(1, nodes as any);
const keyC = buildRunIdempotencyKey(2, nodes as any);
ok(keyA === keyB, "idempotency key is deterministic");
ok(keyA !== keyC, "idempotency key includes recipe id");

ok(classifyDlqAction({ step: "gen-poll", attempts: 1, error: "timeout", budgetRemaining: 2 }) === "replay_from_step", "poll timeout can replay from step");
ok(classifyDlqAction({ step: "submit", attempts: 1, error: "exhausted balance", budgetRemaining: 2 }) === "stop_budget", "provider balance errors stop budget");
ok(classifyDlqAction({ step: "otk", attempts: 3, error: "low quality", budgetRemaining: 2 }) === "hold_for_operator", "attempt cap goes to operator hold");

ok(!budgetGuard({ estimatedUsd: 4, budgetUsd: 10, spentUsd: 3, worstCaseMultiplier: 3 }).ok, "worst-case budget blocks overrun");
ok(budgetGuard({ estimatedUsd: 1, budgetUsd: 10, spentUsd: 3, worstCaseMultiplier: 3 }).ok, "budget allows safe run");

ok(shouldPromoteWinner({ otkScore: 8, basis: "model", artifactOk: true, views: 1000, status: "otk_pass" }).decision === "promote", "frames-grounded quality plus market signal promotes");
ok(shouldPromoteWinner({ otkScore: 9, basis: "text", artifactOk: true, views: 1000, status: "otk_pass" }).decision === "keep_learning", "text-only OTK cannot auto-promote");

ok(planNextSeriesBatch({ completedRuns: 5, feedbackItems: 0, budgetOk: true, latestPassRate: 0.2 }).decision === "hold_for_feedback", "every 5 runs require feedback before next batch");
ok(planNextSeriesBatch({ completedRuns: 6, feedbackItems: 3, budgetOk: true, latestPassRate: 0.2 }).nextCount === 5, "planner schedules next batch when ready");

const payload = workerHandoffPayload({ step: "submit", nodes: [], idempotency_key: "k", lane: "product", lane_budget: 3 } as any);
ok(payload.idempotency_key === "k" && payload.budget === 3, "worker handoff exposes idempotency and budget");

const graphRun = fs.readFileSync("lib/factory/graphRun.ts", "utf8");
const graphRoute = fs.readFileSync("app/api/factory/graph-run/route.ts", "utf8");
const batchRoute = fs.readFileSync("app/api/factory/batch/route.ts", "utf8");
ok(/buildRunIdempotencyKey/.test(graphRun), "graph-run builds idempotency key");
ok(/buildRunPlan\(rows, recipeId\)/.test(graphRoute), "manual graph-run passes recipe id to idempotency");
ok(/buildRunPlan\(rows, rid\)/.test(batchRoute), "batch graph-run passes recipe id to idempotency");

console.log("factoryV2Runtime: passed");
