import assert from "node:assert/strict";
import test from "node:test";
import {
  coverageForPeriod,
  currentMoscowDate,
  forecastAdditiveMetric,
  forecastRatioMetric,
  hideFutureValues,
  statusForCoverage,
} from "../lib/rnp/forecast";

test("future RNP days stay unavailable instead of becoming zero", () => {
  assert.deepEqual(
    hideFutureValues(
      ["2026-07-12", "2026-07-13", "2026-07-14"],
      [12, 8, 0],
      "2026-07-13",
    ),
    [12, 8, null],
  );
});

test("RNP forecast extends fact with weekday and trend and returns a confidence range", () => {
  const days = Array.from({ length: 10 }, (_, index) => `2026-07-${String(index + 1).padStart(2, "0")}`);
  const result = forecastAdditiveMetric(days, [10, 12, 11, 13, 12, 14, 15, null, null, null], "2026-07-07");
  assert.ok(result);
  assert.equal(result.observedDays, 7);
  assert.equal(result.futureDays, 3);
  assert.ok(result.value > 87);
  assert.ok(result.low <= result.value);
  assert.ok(result.high >= result.value);
  assert.match(result.method, /дня недели/);
});

test("missing funnel dates reduce coverage and never look ready", () => {
  const days = ["2026-07-11", "2026-07-12", "2026-07-13"];
  const values = [100, null, 120];
  assert.equal(coverageForPeriod(days, values, "2026-07-13"), 66.7);
  assert.equal(statusForCoverage(66.7), "partial");
  assert.equal(statusForCoverage(0), "unavailable");
});

test("ratio forecast uses the conservative bounds of both source forecasts", () => {
  const spend = forecastAdditiveMetric(
    ["2026-07-01", "2026-07-02", "2026-07-03"],
    [10, 10, null],
    "2026-07-02",
  );
  const revenue = forecastAdditiveMetric(
    ["2026-07-01", "2026-07-02", "2026-07-03"],
    [100, 100, null],
    "2026-07-02",
  );
  const ratio = forecastRatioMetric(spend, revenue);
  assert.ok(ratio);
  assert.equal(Math.round(ratio.value), 10);
  assert.ok(ratio.low <= ratio.value);
  assert.ok(ratio.high >= ratio.value);
});

test("Moscow as-of date does not roll over with UTC", () => {
  assert.equal(currentMoscowDate(new Date("2026-07-13T21:30:00.000Z")), "2026-07-14");
});
