import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Regression: ISSUE-006 — Vercel killed the first all-cabinet snapshot at 60 seconds.
test("sklejki cold snapshot has enough time to populate the hourly cache", async () => {
  const route = await readFile(new URL("../app/api/sklejki/route.ts", import.meta.url), "utf8");
  assert.match(route, /maxDuration\s*=\s*300/);
  assert.match(route, /Promise\.allSettled/);
  assert.match(route, /loadSklejkiSnapshot\(cabinet\.id/);
  assert.match(route, /feedbackQuery = feedbackQuery\.eq\("cabinet_id", cabinetId\)/);
  assert.match(route, /loadCabinetPimRowsHourly\(cabinetId\)/);
});
