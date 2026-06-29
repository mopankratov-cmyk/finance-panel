import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const graphRun = readFileSync("lib/factory/graphRun.ts", "utf8");
const graphTypes = readFileSync("lib/factory/graphTypes.ts", "utf8");

ok(/"clip-qa"/.test(graphTypes), "RunStep includes clip-qa");
ok(/runClipQa/.test(graphRun), "graph-run calls in-process clip QA");
ok(/persistClips\(db, plan\.nodes\.filter[\s\S]*plan\.step = "clip-qa";/.test(graphRun), "graph-run persists intermediate generated clips before clip QA");
ok(/plan\.step = "clip-qa";[\s\S]*gen-poll→clip-qa/.test(graphRun), "gen-poll advances to clip-qa before assemble");
ok(/if \(plan\.step === "clip-qa"\)/.test(graphRun), "graph-run has clip-qa state handler");
ok(/clip-qa→assemble/.test(graphRun), "clip-qa advances to assemble after pass");
ok(/clip-qa reject/.test(graphRun), "clip-qa records rejects before assembly");

console.log("clipQaStepContract: passed");
