import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const observability = readFileSync("lib/factory/observability.ts", "utf8");
const studio = readFileSync("public/inferno/studio.html", "utf8");

ok(/step: string \| null;/.test(observability), "recent run point exposes current graph step");
ok(/active_step: string \| null;/.test(observability), "recent run point exposes active execution-log step");
ok(/step: plan\.step \? String\(plan\.step\) : null/.test(observability), "observability maps run_plan.step into recent runs");
ok(/async function tickGraphRun\(recipeId, btn\)/.test(studio), "Studio defines a reusable graph-run tick action");
ok(/api\("\/graph-run\/tick"/.test(studio), "Studio tick action calls graph-run tick endpoint");
ok(/String\(run\.status\|\|""\)==="running"&&run\.recipe_id!=null/.test(studio), "worker pulse only shows tick for running recipe rows");
ok(/step "\+String\(run\.step\)/.test(studio), "worker pulse renders current run step");

console.log("workerPulseTickContract: passed");
