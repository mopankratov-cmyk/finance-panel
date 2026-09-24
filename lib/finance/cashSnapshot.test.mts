import assert from "node:assert/strict";
import test from "node:test";
import { bankOpeningAtDate, cashDifference, dayBefore } from "./cashSnapshot.ts";

test("dayBefore handles month and year boundaries", () => {
  assert.equal(dayBefore("2026-10-01"), "2026-09-30");
  assert.equal(dayBefore("2026-01-01"), "2025-12-31");
});

test("opening balance is exact when statement starts on snapshot day", () => {
  assert.equal(bankOpeningAtDate(
    { id: "s", dateFrom: "2026-10-01", dateTo: "2026-10-31", openingBalance: 125_000 },
    [{ statementId: "s", date: "2026-10-01", amount: -10_000 }],
    "2026-10-01",
  ), 125_000);
});

test("opening balance is reconstructed for a statement spanning the date", () => {
  assert.equal(bankOpeningAtDate(
    { id: "s", dateFrom: "2026-09-28", dateTo: "2026-10-03", openingBalance: 100_000 },
    [
      { statementId: "s", date: "2026-09-29", amount: 25_000 },
      { statementId: "s", date: "2026-10-01", amount: -50_000 },
    ],
    "2026-10-01",
  ), 125_000);
  assert.equal(cashDifference(125_000, 124_999.995), 0.01);
});
