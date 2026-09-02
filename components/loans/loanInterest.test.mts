import assert from "node:assert/strict";
import test from "node:test";
import { buildSplitMonthlyInterestSchedule, fixedMonthlyInterest } from "./loanInterest.ts";

test("monthly loan interest is fixed and rounded to tenths", () => {
  assert.equal(fixedMonthlyInterest(5_000_000, 38), 158_333.3);
});

test("a five-percent monthly rate is split by period days and tranche dates", () => {
  const rows = buildSplitMonthlyInterestSchedule({
    disbursements: [
      { date: "2026-01-29", amount: 2_000 },
      { date: "2026-04-15", amount: 3_000 },
      { date: "2026-04-29", amount: 15_000 },
      { date: "2026-05-10", amount: 8_000 },
      { date: "2026-06-01", amount: 8_250 },
    ],
    monthlyRate: 5,
    dueDate: "2027-03-31",
  });
  const june16 = rows.find((row) => row.date === "2026-06-16");
  const june30 = rows.find((row) => row.date === "2026-06-30");
  assert.equal(june16?.interest, 952.9);
  assert.equal(june30?.interest, 845.8);
  assert.notEqual(june16?.interest, june30?.interest);
  assert.equal(rows.at(-1)?.principal, 36_250);
});
