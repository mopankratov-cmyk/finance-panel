import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const graphRun = readFileSync("lib/factory/graphRun.ts", "utf8");
const graphTypes = readFileSync("lib/factory/graphTypes.ts", "utf8");

ok(/bestOtk\?: RunOtkVerdict/.test(graphTypes), "RunPlan stores best OTK verdict alongside best URL");
ok(/plan\.bestOtk = plan\.otk/.test(graphRun), "graph-run snapshots OTK verdict when a new best score is found");
ok(/const otkForBank = plan\.bestOtk \|\| plan\.otk \|\| null/.test(graphRun), "bank step evaluates the best attempt verdict");
ok(/isFramesGroundedOtkVerdictPass\(otkForBank, artifactOk\)/.test(graphRun), "bank gate checks best verdict rather than stale latest verdict");
ok(/otk_verdict: otkForBank/.test(graphRun), "final recipe verdict reflects the banked best attempt");

console.log("graphRunBestOtkContract: passed");
