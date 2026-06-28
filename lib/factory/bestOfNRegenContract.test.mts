import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const graphRun = readFileSync("lib/factory/graphRun.ts", "utf8");
const graphTypes = readFileSync("lib/factory/graphTypes.ts", "utf8");

ok(/bestScore\?: number \| null;/.test(graphTypes), "RunPlan persists best OTK score across regen attempts");
ok(/bestUrl\?: string \| null;/.test(graphTypes), "RunPlan persists best output URL across regen attempts");
ok(/bestOtk\?: RunOtkVerdict \| null;/.test(graphTypes), "RunPlan persists best OTK verdict across regen attempts");
ok(/lane_budget\?: number \| null;/.test(graphTypes), "RunPlan carries lane-specific render budget");

ok(/const renderCount = submitAlreadyStarted \? \(plan\.renderCount \|\| 1\) : \(plan\.renderCount \|\| 0\) \+ 1;/.test(graphRun), "submit increments renderCount only for a new paid generation attempt");
ok(/if \(!submitAlreadyStarted && renderCount > laneBudget\) throw new Error/.test(graphRun), "submit blocks paid generation beyond lane budget");
ok(/plan\.renderCount = renderCount;/.test(graphRun), "submit persists renderCount before external provider calls");
ok(/if \(\(plan\.renderCount \|\| 0\) < laneBudget && isRegenerable\(n\)\)/.test(graphRun), "clip QA regen is lane-budget bounded");
ok(/if \(!otkPassed && \(plan\.renderCount \|\| 0\) < laneBudget\)/.test(graphRun), "OTK regen is lane-budget bounded");

ok(/if \(score != null && score > \(plan\.bestScore \?\? -1\)\) \{[\s\S]*plan\.bestScore = score;[\s\S]*plan\.bestUrl = url;[\s\S]*plan\.bestOtk = plan\.otk;[\s\S]*\}/.test(graphRun), "OTK step updates best attempt only when score improves");
ok(/const url = plan\.bestUrl \|\| plan\.output_url;/.test(graphRun), "bank uses best output URL instead of the last attempted URL");
ok(/const score = plan\.bestScore != null \? plan\.bestScore : \(plan\.otk\?\.score \?\? null\);/.test(graphRun), "bank uses best score instead of the last attempted score");
ok(/const otkForBank = plan\.bestOtk \|\| plan\.otk \|\| null;/.test(graphRun), "bank uses best OTK verdict for quality decision");

console.log("bestOfNRegenContract: passed");
