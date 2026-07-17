import assert from "node:assert/strict";
import test from "node:test";

import { wbSyncHealthStatus } from "../lib/sync/wbSyncHealthStatus";

// Regression: ISSUE-002 — /sync showed "догружается 100%" for a fresh completed snapshot.
// Found by /qa on 2026-07-17
// Report: .gstack/qa-reports/qa-report-finance-panel-two-vercel-app-2026-07-17.md
test("fresh full-coverage cursor jobs are displayed as caught up, not loading forever", () => {
  assert.deepEqual(
    wbSyncHealthStatus({
      progressStatus: "running",
      stale: false,
      hasLastSyncedAt: true,
      coveragePct: 100,
    }),
    { status: "caught_up", lastError: null },
  );
});

test("partial cursor jobs still stay in progress", () => {
  assert.deepEqual(
    wbSyncHealthStatus({
      progressStatus: "running",
      stale: false,
      hasLastSyncedAt: true,
      coveragePct: 66.7,
    }),
    { status: "running", lastError: null },
  );
});
