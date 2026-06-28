import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const graphRun = readFileSync("lib/factory/graphRun.ts", "utf8");
const graphTypes = readFileSync("lib/factory/graphTypes.ts", "utf8");

ok(/function isFramesGroundedOtkPass/.test(graphRun), "graph-run has a single frames-grounded OTK pass predicate");
ok(/basis === "text" \|\| basis === "fallback" \|\| basis === "storyboard"/.test(graphRun), "text/storyboard/fallback basis cannot pass OTK");
ok(/score == null \|\| score < 7/.test(graphRun), "OTK pass predicate enforces score >= 7");
ok(/artifact_ok\?: boolean/.test(graphTypes), "RunPlan stores artifact gate result inside OTK verdict");
ok(/if \(!otkPassed && \(plan\.renderCount \|\| 0\) < MAX_RENDERS\)/.test(graphRun), "failed OTK attempts enter bounded regen before bank");
ok(/await regenCulprit/.test(graphRun), "OTK failure uses existing culprit regen loop");
ok(/if \(url && qualityPassed\)/.test(graphRun), "gen-save catalog banking only happens after quality pass");
ok(/finalStatus === "otk_pass" \? "approved" : "rejected"/.test(graphRun), "cf_signals records rejected for non-pass outcomes");
ok(/source: "graph_run_otk_gate"/.test(graphRun), "OTK gate signal is traceable");

console.log("otkGateContract: passed");
