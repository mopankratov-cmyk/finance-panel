import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("completed partial WB jobs release their active lease", () => {
  const advertStats = readFileSync(new URL("../app/api/sync/advert-stats/route.ts", import.meta.url), "utf8");
  const funnel = readFileSync(new URL("../app/api/sync/funnel/route.ts", import.meta.url), "utf8");
  const cabinets = readFileSync(new URL("../lib/sync/cabinets.ts", import.meta.url), "utf8");

  assert.match(advertStats, /nextBatch === 0 \? "caught_up" : "pending"/);
  assert.match(funnel, /nextBatch === 0 \? "caught_up" : "pending"/);
  assert.match(cabinets, /if \(db && !result\.caughtUp\)[\s\S]*?status: "pending"/);
});
