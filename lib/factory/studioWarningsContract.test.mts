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

const studioRoute = readFileSync("app/api/factory/studio/route.ts", "utf8");

ok(/const warnings: string\[\] = \[\];/.test(studioRoute), "studio route collects warnings");
ok(/warnings\.push\(\"viral feed unavailable: /.test(studioRoute), "studio route records feed degradation");
ok(/warnings\.push\(\"templates unavailable: /.test(studioRoute), "studio route records templates degradation");
ok(/warnings\.push\(\"recipes unavailable: /.test(studioRoute), "studio route records niche recipes degradation");
ok(/warnings\.push\(\"generations unavailable: /.test(studioRoute), "studio route records generations degradation");
ok(/warnings\.push\(\"recipes\/observability unavailable: /.test(studioRoute), "studio route records overview observability degradation");
ok(/ok: true, niche, feed, templates, recipes, warnings/.test(studioRoute), "studio niche response exposes warnings");
ok(/ok: true, niches, generations, recipes, observability, warnings/.test(studioRoute), "studio overview response exposes warnings");

if (failed) process.exit(1);
console.log(`studioWarningsContract: ${passed} passed, ${failed} failed`);
