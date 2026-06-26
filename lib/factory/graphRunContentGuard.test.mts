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
const graphRunRoute = readFileSync("app/api/factory/graph-run/route.ts", "utf8");
const recompose = readFileSync("app/api/factory/reel-recompose/route.ts", "utf8");
const assemble = readFileSync("app/api/factory/assemble/route.ts", "utf8");
const scenario = readFileSync("app/api/factory/scenario/route.ts", "utf8");
const autofill = readFileSync("app/api/factory/autofill/route.ts", "utf8");

ok(/defaultFactoryCtaButton\(mode, article\)/.test(graphRun), "graph-run reel props use mode-aware CTA button");
ok(/defaultFactoryCaption\(mode, article\)/.test(graphRun), "graph-run Shotstack caption fallback uses mode-aware copy");
ok(/recipe placeholder: single disk_real clip without a real hook\/caption/.test(graphRun), "graph-run warns on placeholder single-clip recipes");
ok(/finalStatus === "otk_pass" \? "approved" : "warning"/.test(graphRun), "graph-run warning runs no longer emit approved signal");
ok(/select\("id,article,niche,mode,run_plan"\)/.test(recompose) && /buildReelProps\([\s\S]*article\)/.test(recompose), "reel-recompose reads recipe mode and still rebuilds reel props");
ok(/defaultFactoryCaption\(mode, article\)/.test(assemble), "assemble route uses mode-aware fallback caption");
ok(/const mode = normalizeContentMode\(body\.mode\);/.test(scenario), "scenario route reads content mode");
ok(/input\.mode === "sell" \? \(input\.article \? `Ищи артикул \$\{input\.article\} на WB` : "Ищи товар на WB"\) : "Сохрани, чтобы не потерять"/.test(scenario), "scenario fallback avoids WB CTA in audience mode");
ok(/n\.human_edited === true && !nodeLooksPlaceholder\(n\)/.test(autofill), "autofill can revisit placeholder manual nodes");
ok(/nodeLooksPlaceholder\(n\)/.test(graphRun), "graph-run considers placeholder nodes as needing autofill");
ok(/body\.autofill \|\| rows\.some\(\(row\) => nodeLooksPlaceholder\(row\)\)/.test(graphRunRoute), "graph-run route auto-enables autofill for placeholder recipes");
ok(/const fallbackAssignments = targets\.map/.test(autofill) && /assignments = fallbackAssignments/.test(autofill), "autofill degrades to deterministic fallback when Claude is unavailable");

if (failed) process.exit(1);
console.log(`graphRunContentGuard: ${passed} passed, ${failed} failed`);
