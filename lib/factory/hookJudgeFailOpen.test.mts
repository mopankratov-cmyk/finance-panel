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

const route = readFileSync("app/api/factory/hook-judge/route.ts", "utf8");

ok(/function firstFallbackHook/.test(route), "hook-judge route has a deterministic fallback winner");
ok(/catch \(e\) \{[\s\S]*const fallback = firstFallbackHook\(body\);[\s\S]*ok: true,[\s\S]*оценка хуков упала, выпуск не заблокирован/.test(route), "hook-judge unexpected crashes degrade to warning");
ok(!/оценка хуков упала[\s\S]*status:\s*500/.test(route), "hook-judge crash path no longer returns HTTP 500");

if (failed) process.exit(1);
console.log(`hookJudgeFailOpen: ${passed} passed, ${failed} failed`);
