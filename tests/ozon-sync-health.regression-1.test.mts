import assert from "node:assert/strict";
import test from "node:test";
import { ozonSyncStatus, summarizeOzonHealth } from "../lib/ozon/cockpitQuality";
import { performanceReportQuality } from "../lib/ozon/performance";

// Regression test for QA ISSUE-004: https://finance-panel-two.vercel.app/ozon/health
test("the sync_log ok status is healthy on the Ozon health dashboard", () => {
  assert.equal(ozonSyncStatus({ status: "ok" }), "ok");
  assert.deepEqual(
    summarizeOzonHealth(["ok", "ok"], { status: "ok" }),
    { healthy: 2, warnings: 0, errors: 0, sync: "ok" },
  );
});

test("a Performance report with no completed batch is unavailable, not a zero-row success", () => {
  assert.deepEqual(performanceReportQuality(20, 20, 2, 0), {
    available: false,
    partial: true,
  });
  assert.deepEqual(performanceReportQuality(20, 20, 2, 1), {
    available: true,
    partial: true,
  });
  assert.deepEqual(performanceReportQuality(20, 20, 2, 2), {
    available: true,
    partial: false,
  });
});
