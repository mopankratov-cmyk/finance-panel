import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { ozonSyncStatus, summarizeOzonHealth } from "../lib/ozon/cockpitQuality";
import { isOzonPerformanceReportDeferredMessage, performanceReportQuality } from "../lib/ozon/performance";

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

test("Ozon Performance async report wait and 429 are warnings on the health dashboard", () => {
  const transient = "Ozon COSMOS: Performance report: batch 1: status NOT_STARTED; batch 2: create HTTP 429";

  assert.equal(isOzonPerformanceReportDeferredMessage(transient), true);
  assert.equal(ozonSyncStatus({ status: "error", error: transient }), "warning");
  assert.deepEqual(
    summarizeOzonHealth(["ok"], { status: "error", error: transient }),
    { healthy: 1, warnings: 1, errors: 0, sync: "warning" },
  );
});

test("Ozon health still keeps real sync failures red", () => {
  assert.equal(isOzonPerformanceReportDeferredMessage("Ozon COSMOS: Supabase insert failed"), false);
  assert.equal(ozonSyncStatus({ status: "error", error: "Supabase insert failed" }), "error");
});

test("deferred Ozon reports release the sync lease after saving their UUID", () => {
  const route = readFileSync(new URL("../app/api/sync/ozon-adverts/route.ts", import.meta.url), "utf8");
  assert.match(route, /if \(!report\.complete\)[\s\S]*?status: "pending"/);
  assert.match(route, /isOzonPerformanceReportDeferredMessage\(message\) \? "pending" : "error"/);
});

test("Ozon health accepts a completed zero-row report as a fresh sync", () => {
  const cockpit = readFileSync(new URL("../lib/ozon/cockpit.ts", import.meta.url), "utf8");
  assert.match(cockpit, /\.eq\("job", "ozon-adverts"\)/);
  assert.match(cockpit, /row\.status === "caught_up"/);
  assert.match(cockpit, /syncCompleted\.get\(cabinet\.id\)/);
});
