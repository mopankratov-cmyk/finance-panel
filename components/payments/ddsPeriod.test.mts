import assert from "node:assert/strict";
import test from "node:test";
import { currentLocalMonth, monthRange, periodLabel, yearRange } from "./ddsPeriod.ts";

test("month range includes the whole month, including leap February", () => {
  assert.deepEqual(monthRange("2024-02"), { from: "2024-02-01", to: "2024-02-29" });
  assert.deepEqual(monthRange("2026-09"), { from: "2026-09-01", to: "2026-09-30" });
});
test("year and custom labels are explicit", () => {
  assert.deepEqual(yearRange(2026), { from: "2026-01-01", to: "2026-12-31" });
  assert.match(periodLabel("2026-09-01", "2026-09-30"), /1 сентября 2026.*30 сентября 2026/);
  assert.equal(currentLocalMonth(new Date(2026, 8, 15)), "2026-09");
});
