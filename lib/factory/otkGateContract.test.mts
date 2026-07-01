import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const graphRun = readFileSync("lib/factory/graphRun.ts", "utf8");
const graphTypes = readFileSync("lib/factory/graphTypes.ts", "utf8");

ok(/function isFramesGroundedOtkPass/.test(graphRun), "graph-run has a single frames-grounded OTK pass predicate");
ok(/function isFramesUnavailableSoftSignal/.test(graphRun), "graph-run has a separate frames_unavailable soft signal predicate");
ok(/basis === "text" \|\| basis === "fallback" \|\| basis === "storyboard"/.test(graphRun), "text/storyboard/fallback basis cannot pass OTK");
ok(/score == null \|\| score < 7/.test(graphRun), "OTK pass predicate enforces score >= 7");
ok(/artifact_ok\?: boolean/.test(graphTypes), "RunPlan stores artifact gate result inside OTK verdict");
ok(/const laneBudget = Math\.max[\s\S]*if \(!otkPassed && \(plan\.renderCount \|\| 0\) < laneBudget\)/.test(graphRun), "failed OTK attempts enter lane-bounded regen before bank");
ok(/await regenCulprit/.test(graphRun), "OTK failure uses existing culprit regen loop");
ok(/if \(url && qualityPassed\)/.test(graphRun), "gen-save catalog banking only happens after quality pass");
ok(/frames_unavailable/.test(graphRun), "non-frame-grounded good-score outcomes are tracked explicitly");
ok(/const qualityStatus = qualityPassed \? "otk_pass" : framesUnavailable \? "frames_unavailable" : "warning"/.test(graphRun), "frames unavailable is distinct from generic warning");
ok(/finalStatus === "otk_pass" \? "approved" : "rejected"/.test(graphRun), "cf_signals records rejected for non-pass outcomes");
ok(/logSignal\(db, "qa_reject"/.test(graphRun), "blocking OTK gate emits qa_reject signal");

console.log("otkGateContract: passed");
