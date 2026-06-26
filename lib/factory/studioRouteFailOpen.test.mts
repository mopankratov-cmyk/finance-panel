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

const route = readFileSync("app/api/factory/studio/route.ts", "utf8");

ok(/function fallbackNiches\(\)/.test(route), "Studio route has fallback niches");
ok(/if \(!db\) \{[\s\S]*Studio открыта в пустом read-only режиме[\s\S]*niches: fallbackNiches\(\)/.test(route), "Studio route missing-db path returns the screen contract");
ok(/if \(niche\) return NextResponse\.json\(\{ ok: true, niche, feed: \[\], templates: \[\], recipes: \[\], warning \}/.test(route), "Studio niche mode also fails open without DB");
ok(/catch \(e\) \{[\s\S]*ok: true,[\s\S]*niches: fallbackNiches\(\),[\s\S]*observability: EMPTY_OBSERVABILITY/.test(route), "Studio route top-level crash path returns fallback screen data");
ok(!/сводка Studio упала[\s\S]*status:\s*500/.test(route), "Studio route no longer turns summary crashes into HTTP 500");

if (failed) process.exit(1);
console.log(`studioRouteFailOpen: ${passed} passed, ${failed} failed`);
