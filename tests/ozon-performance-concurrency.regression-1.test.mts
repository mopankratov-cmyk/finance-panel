import assert from "node:assert/strict";
import test from "node:test";
import { runWithConcurrency } from "../lib/ozon/performance";

// Regression: ISSUE-004 — five simultaneous Ozon async reports failed for both cabinets
// Found by /qa on 2026-07-14
// Report: .gstack/qa-reports/qa-report-finance-panel-two-vercel-app-2026-07-14.md
test("Ozon Performance report generation is bounded to two concurrent batches", async () => {
  let active = 0;
  let maxActive = 0;
  const results = await runWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (value) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return value * 10;
  });

  assert.equal(maxActive, 2);
  assert.deepEqual(results, [10, 20, 30, 40, 50, 60]);
});

test("Ozon Performance concurrency never becomes zero", async () => {
  const results = await runWithConcurrency(["campaign"], 0, async (value) => value);
  assert.deepEqual(results, ["campaign"]);
});
