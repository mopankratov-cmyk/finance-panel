import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const source = readFileSync("lib/factory/graphRun.ts", "utf8");

ok(/type OtkGateMode = "shadow" \| "block_broken" \| "strict"/.test(source), "OTK gate has explicit ramp modes");
ok(/FACTORY_OTK_FAIL_OPEN/.test(source), "OTK gate has explicit owner fail-open override");
ok(/FACTORY_OTK_GATE_MODE \|\| "block_broken"/.test(source), "OTK gate defaults to block_broken");
ok(/function shouldBlockOtk/.test(source), "OTK block decision is centralized");
ok(/if \(!artifactOk\) return \{ block: true/.test(source), "block_broken rejects broken artifacts");
ok(/mode === "strict" && !isFramesGroundedOtkPass/.test(source), "strict mode blocks non-frame-grounded or low-score OTK");
ok(/await logSignal\(db, "qa_reject"/.test(source), "blocked OTK emits qa_reject signal");

console.log("otkGateRampContract: passed");
