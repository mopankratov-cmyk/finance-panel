import assert from "node:assert/strict";
import test from "node:test";
import { runFunnelTargetsConcurrently } from "../lib/wb/funnelPeriod";

// Regression: ISSUE-003 — a slow first seller starved Optima funnel refresh
// Found by /qa on 2026-07-14
// Report: .gstack/qa-reports/qa-report-finance-panel-two-vercel-app-2026-07-14.md
test("independent WB seller cabinets start funnel refresh concurrently", async () => {
  let active = 0;
  let maxActive = 0;
  const completed: string[] = [];

  await runFunnelTargetsConcurrently(
    ["CLERIN", "COSMOS SHOP", "Retail Family", "Optima"],
    async (cabinet) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      completed.push(cabinet);
      active -= 1;
    },
  );

  assert.equal(maxActive, 4);
  assert.deepEqual(completed.sort(), ["CLERIN", "COSMOS SHOP", "Optima", "Retail Family"]);
});
