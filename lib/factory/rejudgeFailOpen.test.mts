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

const route = readFileSync("app/api/factory/graph-run/rejudge/route.ts", "utf8");

ok(/async function persistWarningResult/.test(route), "rejudge route has a shared fail-open warning persistence helper");
ok(/rejudge extractFrames warning/.test(route), "extractFrames failures degrade to warning instead of aborting rejudge item");
ok(/rejudge warning: не извлеклись кадры для повторного ОТК/.test(route), "missing frames degrade to warning");
ok(/rejudge critic warning:/.test(route), "critic transport failures degrade to warning");
ok(/rejudge warning: video-critic не вернул score/.test(route), "empty critic score degrades to warning");
ok(/status:\s*"warning"[\s\S]*otk_verdict:\s*nextPlan\.otk \?\? null/.test(route), "fail-open helper persists warning status without dropping output");

if (failed) process.exit(1);
console.log(`rejudgeFailOpen: ${passed} passed, ${failed} failed`);
