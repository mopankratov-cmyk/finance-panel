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

const route = readFileSync("app/api/factory/observer/route.ts", "utf8");
const pulse = readFileSync("lib/factory/observerPulse.ts", "utf8");

ok(/if \(!db\) \{[\s\S]*ok: true,[\s\S]*partial: true,[\s\S]*Supabase не настроен/.test(route), "observer missing-db path is fail-open");
ok(/catch \(e\) \{[\s\S]*ok: true,[\s\S]*partial: true,[\s\S]*observer crash/.test(route), "observer crash path is fail-open");
ok((route.match(/Cache-Control": "no-store"/g) || []).length >= 3, "observer responses remain no-store");
ok(/const out: Record<string, unknown> = \{[\s\S]*ok: true,[\s\S]*partial: false/.test(pulse), "observer pulse defaults to ok non-partial");
ok(/catch \{[\s\S]*out\.partial = true;[\s\S]*return out;/.test(pulse), "observer pulse internal errors degrade to partial");

if (failed) process.exit(1);
console.log(`observerFailOpen: ${passed} passed, ${failed} failed`);
