import assert from "node:assert/strict";
import test from "node:test";
import { reportSyncBlocksMonth, type ReportSyncStateRow } from "./reportSyncReadiness";

const running: ReportSyncStateRow = {
  cabinet_id: "optima",
  status: "running",
  state: { periodDateFrom: "2026-08-01", periodDateTo: "2026-09-21" },
};

test("incomplete report sync blocks every overlapping OPIU month", () => {
  assert.equal(reportSyncBlocksMonth(running, "2026-08-01", "2026-08-31", "2026-09-21"), true);
  assert.equal(reportSyncBlocksMonth(running, "2026-09-01", "2026-09-30", "2026-09-21"), true);
});

test("complete, missing and non-overlapping sync state do not block the month", () => {
  assert.equal(reportSyncBlocksMonth({ ...running, status: "complete" }, "2026-08-01", "2026-08-31", "2026-09-21"), false);
  assert.equal(reportSyncBlocksMonth(undefined, "2026-08-01", "2026-08-31", "2026-09-21"), false);
  assert.equal(reportSyncBlocksMonth(running, "2026-07-01", "2026-07-31", "2026-09-21"), false);
});

test("incremental refresh keeps already completed past months available", () => {
  const incremental: ReportSyncStateRow = {
    ...running,
    state: { ...running.state, completedPeriodDateTo: "2026-09-20" },
  };
  assert.equal(reportSyncBlocksMonth(incremental, "2026-08-01", "2026-08-31", "2026-09-21"), false);
  assert.equal(reportSyncBlocksMonth(incremental, "2026-09-01", "2026-09-30", "2026-09-21"), true);
});
