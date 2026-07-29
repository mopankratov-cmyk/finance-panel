import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { pointInTimeMetricDaily } from "../lib/rnp/buildTable";
import { funnelGapRecoveryPeriod } from "../lib/wb/funnelPeriod";

test("RNP puts current stock KPIs into the actual snapshot day only", () => {
  const days = ["2026-07-14", "2026-07-15", "2026-07-16", "2026-07-17"];

  assert.deepEqual(pointInTimeMetricDaily(days, "2026-07-16", 8_843), [null, null, 8_843, null]);
  assert.deepEqual(pointInTimeMetricDaily(days, "2026-07-16", null), [null, null, null, null]);
});

test("funnel sync repairs the earliest incomplete seven-day calendar window", () => {
  const dates = [
    "2026-06-23",
    "2026-06-24",
    "2026-06-25",
    "2026-06-26",
    "2026-06-27",
    "2026-06-28",
    "2026-06-29",
    "2026-06-30",
    "2026-07-01",
    "2026-07-02",
  ];
  const rows = [1, 2].flatMap((nm_id) => dates
    .filter((date) => date < "2026-06-25")
    .map((date) => ({ nm_id, date })));

  assert.deepEqual(
    funnelGapRecoveryPeriod(dates, [1, 2], rows, {
      begin: "2026-07-02",
      end: "2026-07-02",
      mode: "yesterday",
    }),
    { begin: "2026-06-25", end: "2026-07-01", mode: "gap-recovery" },
  );
});

test("funnel sync keeps the regular period after complete calendar coverage", () => {
  const dates = ["2026-07-01", "2026-07-02"];
  const rows = [1, 2].flatMap((nm_id) => dates.map((date) => ({ nm_id, date })));
  const fallback = { begin: "2026-07-02", end: "2026-07-02", mode: "yesterday" };

  assert.deepEqual(funnelGapRecoveryPeriod(dates, [1, 2], rows, fallback), fallback);
});

test("manual funnel period is never replaced by automatic recovery", () => {
  const manual = { begin: "2026-05-01", end: "2026-05-07", mode: "manual" };

  assert.deepEqual(funnelGapRecoveryPeriod(["2026-07-01"], [1], [], manual), manual);
});

test("regular funnel recovery never asks WB for dates older than the last seven closed days", () => {
  const route = readFileSync(new URL("../app/api/sync/funnel/route.ts", import.meta.url), "utf8");

  assert.match(route, /const recoveryDates = closedMoscowDates\(7\)/);
});
