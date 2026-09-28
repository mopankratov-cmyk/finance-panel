import assert from "node:assert/strict";
import test from "node:test";
import { buildOzonOpiuDateRangeWarning } from "./opiuOzonDateRangeWarning.ts";

test("warns when dateFrom is older than the accrual backfill window", () => {
  const warning = buildOzonOpiuDateRangeWarning("2026-01-01", new Date("2026-09-25T00:00:00.000Z"));
  assert.match(warning ?? "", /75/);
});

test("does not warn when dateFrom is within the backfill window", () => {
  const warning = buildOzonOpiuDateRangeWarning("2026-09-01", new Date("2026-09-25T00:00:00.000Z"));
  assert.equal(warning, null);
});

test("does not warn exactly at the backfill floor", () => {
  // 75 days before 2026-09-25 is 2026-07-12.
  const warning = buildOzonOpiuDateRangeWarning("2026-07-12", new Date("2026-09-25T00:00:00.000Z"));
  assert.equal(warning, null);
});
