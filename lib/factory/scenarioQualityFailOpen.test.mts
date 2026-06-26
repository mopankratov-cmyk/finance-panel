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

const route = readFileSync("app/api/factory/scenario-quality/route.ts", "utf8");
const quality = readFileSync("lib/factory/scenarioQuality.ts", "utf8");

ok(/catch \(error\) \{[\s\S]*source: "fallback"[\s\S]*error: String\(error\)\.slice/.test(quality), "scenario quality library degrades model failures to fallback scoring");
ok(/catch \(e\) \{[\s\S]*ok: true,[\s\S]*проверка сценария упала, выпуск не заблокирован[\s\S]*should_render: true/.test(route), "scenario-quality route stays fail-open on unexpected crashes");
ok(!/status:\s*500/.test(route), "scenario-quality route does not fail closed with HTTP 500");

if (failed) process.exit(1);
console.log(`scenarioQualityFailOpen: ${passed} passed, ${failed} failed`);
