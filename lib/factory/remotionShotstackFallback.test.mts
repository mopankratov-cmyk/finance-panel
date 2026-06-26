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

ok(/\(plan as any\)\.edit_json = edit;[\s\S]*render-poll может переключиться на Shotstack/.test(graphRun), "assemble keeps Shotstack edit_json even when Remotion is selected");
ok(/if \(plan\.render_engine === "remotion" && \(plan as any\)\.edit_json && shotstackReady\(\)\)/.test(graphRun), "Remotion non-retryable errors can fall back to Shotstack");
ok(/fallback Shotstack/.test(graphRun), "fallback warning identifies Shotstack retry instead of raw clip");
ok(/plan\.render_engine = "shotstack";[\s\S]*plan\.render_id = null;[\s\S]*plan\.step = "render-submit";/.test(graphRun), "fallback resets render state for a fresh Shotstack submit");
ok(/fallback raw clip/.test(graphRun), "raw clip fallback remains as final fail-open path");

if (failed) process.exit(1);
console.log(`remotionShotstackFallback: ${passed} passed, ${failed} failed`);
