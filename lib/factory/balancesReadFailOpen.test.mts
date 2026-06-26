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

const route = readFileSync("app/api/factory/balances/route.ts", "utf8");
const getRoute = route.split("export async function POST")[0] || route;

ok(/function emptyServices\(\)/.test(route), "balances GET has an empty service fallback");
ok(/if \(!db\) return NextResponse\.json\(\{ ok: true, services: emptyServices\(\), low: \[\], warning: "Supabase не настроен/.test(route), "balances GET missing-db path is fail-open");
ok(/catch \(e\) \{[\s\S]*ok: true, services: emptyServices\(\), low: \[\], warning: "балансы упали: "/.test(route), "balances GET crash path is fail-open");
ok(/export async function POST[\s\S]*status:\s*500/.test(route), "balances POST keeps strict write errors");
ok(!/status:\s*500/.test(getRoute), "balances GET no longer returns HTTP 500");

if (failed) process.exit(1);
console.log(`balancesReadFailOpen: ${passed} passed, ${failed} failed`);
