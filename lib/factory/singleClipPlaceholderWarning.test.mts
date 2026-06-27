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

ok(/function needsSingleClipStorySupport\(plan: RunPlan, visualNodes: RunNode\[\]\): boolean \{/.test(graphRun), "graph-run keeps a separate story-support helper for single-clip recipes");
ok(/if \(!hasStoryNode\) return true;/.test(graphRun), "single-clip recipes without story nodes still get synthetic hook and CTA support");
ok(/function isPlaceholderSingleClipRecipe\(plan: RunPlan, visualNodes: RunNode\[\]\): boolean \{[\s\S]*if \(!needsSingleClipStorySupport\(plan, visualNodes\)\) return false;/.test(graphRun), "warning helper is narrower than story-support helper");
ok(/return copy\.length === 0 \|\| copy\.every\(\(value\) => isPlaceholderNarrative\(value\)\);/.test(graphRun), "placeholder warning now fires only for empty or fully placeholder copy");

if (failed) process.exit(1);
console.log(`singleClipPlaceholderWarning: ${passed} passed, ${failed} failed`);
