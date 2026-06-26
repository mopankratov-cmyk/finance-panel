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

const route = readFileSync("app/api/factory/niche-brief/route.ts", "utf8");

ok(/function fallbackBrief\(niche: string, reason: string/.test(route), "niche-brief has a structured fallback brief");
ok(/if \(!db\) return fallbackBrief\(niche, "Supabase не настроен — показан fallback-бриф"\)/.test(route), "niche-brief build path is fail-open without Supabase");
ok(/if \(!client\) return fallbackBrief\(niche, "ANTHROPIC_API_KEY не настроен — показан fallback-бриф", sources\)/.test(route), "niche-brief is fail-open without Claude");
ok(/return NextResponse\.json\(fallbackBrief\("default", "бриф ниши упал: "/.test(route), "niche-brief top-level crash path returns fallback JSON");
ok(!/бриф ниши упал:[\s\S]*status:\s*500/.test(route), "niche-brief no longer turns advisor crashes into HTTP 500");

if (failed) process.exit(1);
console.log(`nicheBriefFailOpen: ${passed} passed, ${failed} failed`);
