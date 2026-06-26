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

const graphRun = readFileSync("lib/factory/graphRun.ts", "utf8");

ok(/function graphRunOtkFallback\(input: \{ mode: string; niche: string; article: string; productName\?: string; reason: string; framesCount: number \}\)/.test(graphRun), "graph-run has a deterministic OTK fallback helper");
ok(/scoreRubric\(axes, mode, niche\)/.test(graphRun), "fallback score is computed through the shared rubric");
ok(/basis: "graph_fallback"/.test(graphRun), "fallback OTK basis is explicit");
ok(/basisReason = fallback\.basisReason/.test(graphRun), "fallback basis reason is persisted into plan.otk");
ok(/addWarning\(`video-critic fallback score used: \$\{fallback\.basisReason\}`\)/.test(graphRun), "missing critic score degrades to an actionable warning");
ok(!/addWarning\("video-critic did not return score"\)/.test(graphRun), "old non-actionable missing-score warning is removed");

if (failed) process.exit(1);
console.log(`graphRunOtkFallback: ${passed} passed, ${failed} failed`);
