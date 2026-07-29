import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Regression: ISSUE-001 — hourly WB sync timed out while restoring 365-day history
// Found by /qa on 2026-07-27
// Report: .gstack/qa-reports/qa-report-finance-panel-two-vercel-app-2026-07-27.md
test("WB history routes reserve enough time for large detail reports", () => {
  const aggregateRoute = readFileSync(
    new URL("../app/api/sync/all/route.ts", import.meta.url),
    "utf8",
  );
  const historyRoute = readFileSync(
    new URL("../app/api/sync/history/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(aggregateRoute, /export const maxDuration = 300/);
  assert.match(historyRoute, /export const maxDuration = 300/);
});
