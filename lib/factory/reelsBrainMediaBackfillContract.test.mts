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

const route = readFileSync("app/api/factory/jobs/reels-brain-media-backfill/route.ts", "utf8");

ok(/function hasTerminalMediaFailure/.test(route), "media backfill route detects terminal media failures");
ok(/media_locator_unresolved/.test(route) && /moov atom not found/.test(route), "media backfill route treats unresolved and corrupted media states as terminal");
ok(/!hasResolvedMediaLocators\(row\) && !hasTerminalMediaFailure\(row\)/.test(route), "media backfill route skips terminal unresolved rows");
ok(/markMediaLocatorUnresolved/.test(route), "media backfill route persists unresolved marker");

if (failed) process.exit(1);
console.log(`reelsBrainMediaBackfillContract: ${passed} passed, ${failed} failed`);
