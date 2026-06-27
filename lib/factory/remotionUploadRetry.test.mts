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
const graphTypes = readFileSync("lib/factory/graphTypes.ts", "utf8");

ok(/const MAX_REMOTION_UPLOAD_RETRIES = 1;/.test(graphRun), "graph-run caps remotion upload resubmits to one retry");
ok(/function isRemotionUploadTransportError\(error: string \| null \| undefined\): boolean \{[\s\S]*text\.includes\("upload"\) && text\.includes\("fetch failed"\)/.test(graphRun), "graph-run recognizes remotion upload fetch failures as transport errors");
ok(/if \(plan\.render_engine === "remotion" && isRemotionUploadTransportError\(s\.error \|\| ""\)\) \{[\s\S]*plan\.render_retry_count = renderRetryCount \+ 1;[\s\S]*plan\.step = "render-submit";/.test(graphRun), "remotion upload transport errors trigger one controlled remotion resubmit");
ok(/render_retry_count\?: number \| null;/.test(graphTypes), "run plan persists remotion upload retry count");

if (failed) process.exit(1);
console.log(`remotionUploadRetry: ${passed} passed, ${failed} failed`);
