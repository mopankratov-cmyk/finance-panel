import assert from "node:assert/strict";
import test from "node:test";
import { selectOpiuReportQueueCabinet } from "../lib/opiu/reportSyncQueue";

const period = { dateFrom: "2026-08-01", dateTo: "2026-09-22" };

test("report queue finishes an existing Optima backfill before opening a new cabinet", () => {
  const selected = selectOpiuReportQueueCabinet(
    ["pankratov", "optima", "filippov"],
    [{
      cabinetId: "optima",
      status: "error",
      updatedAt: "2026-09-21T18:58:37.648Z",
      state: { periodDateFrom: "2026-08-01", cursor: 3132161367019, synced: 214029 },
    }],
    period,
  );

  assert.equal(selected, "optima");
});

test("report queue selects the cabinet with the oldest completed report date", () => {
  const selected = selectOpiuReportQueueCabinet(
    ["one", "two", "three"],
    [
      { cabinetId: "one", status: "complete", updatedAt: "2026-09-22T01:00:00Z", state: { periodDateFrom: "2026-08-01", completedPeriodDateTo: "2026-09-21" } },
      { cabinetId: "two", status: "complete", updatedAt: "2026-09-22T02:00:00Z", state: { periodDateFrom: "2026-08-01", completedPeriodDateTo: "2026-09-20" } },
      { cabinetId: "three", status: "complete", updatedAt: "2026-09-22T03:00:00Z", state: { periodDateFrom: "2026-08-01", completedPeriodDateTo: "2026-09-22" } },
    ],
    period,
  );

  assert.equal(selected, "two");
});

test("report queue treats progress from an old refresh window as stale", () => {
  const selected = selectOpiuReportQueueCabinet(
    ["old", "current"],
    [
      { cabinetId: "old", status: "error", updatedAt: "2026-09-01T00:00:00Z", state: { periodDateFrom: "2026-07-01", cursor: 999 } },
      { cabinetId: "current", status: "running", updatedAt: "2026-09-22T00:00:00Z", state: { periodDateFrom: "2026-08-01", cursor: 1 } },
    ],
    period,
  );

  assert.equal(selected, "current");
});

test("report queue returns null without configured cabinets", () => {
  assert.equal(selectOpiuReportQueueCabinet([], [], period), null);
});
