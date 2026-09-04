import assert from "node:assert/strict";
import test from "node:test";
import { actualLoanBalance, buildMonthlyLoanSummary, projectedLoanBalances } from "./portfolioSummary.ts";
import type { LoanScheduleDraft } from "./schedule.ts";

const row = (over: Partial<LoanScheduleDraft>): LoanScheduleDraft => ({
  id: crypto.randomUUID(), date: "2026-09-01", principal: 0, interest: 0, penalty: 0, fine: 0, status: "planned", ...over,
});

test("плановое ежемесячное тело уменьшает прогнозный остаток в каждой строке", () => {
  const schedule = [
    row({ id: "a", date: "2026-09-01", principal: 100_000 }),
    row({ id: "b", date: "2026-10-01", principal: 100_000 }),
    row({ id: "c", date: "2026-11-01", principal: 100_000 }),
  ];
  assert.deepEqual(projectedLoanBalances(500_000, schedule).map((item) => item.balanceAfter), [400_000, 300_000, 200_000]);
  assert.equal(actualLoanBalance(500_000, schedule, "2026-10-31"), 500_000, "неоплаченный план не уменьшает фактический долг");
});

test("договорный остаток поддерживает поквартальный рост тела", () => {
  const schedule = [
    row({ id: "q1", date: "2026-03-31", interest: 150_000, balanceBefore: 5_000_000, balanceAfter: 5_450_000 }),
    row({ id: "q2", date: "2026-06-30", interest: 163_500, balanceBefore: 5_450_000, balanceAfter: 5_940_500 }),
  ];
  assert.deepEqual(projectedLoanBalances(5_000_000, schedule).map((item) => item.balanceAfter), [5_450_000, 5_940_500]);
  assert.equal(actualLoanBalance(5_000_000, schedule, "2026-07-01"), 5_450_000, "до фактической оплаты берётся остаток перед последней обязанностью");
});

test("помесячный свод разделяет начислено, остаток и факт", () => {
  const schedule = [
    row({ date: "2026-09-10", principal: 100_000, interest: 20_000, status: "done" }),
    row({ date: "2026-10-10", principal: 100_000, interest: 18_000 }),
  ];
  const summary = buildMonthlyLoanSummary([{ id: "L", principalAmount: 500_000 }], new Map([["L", schedule]]), "2026-09-01", "2026-10-31");
  assert.deepEqual(summary, [
    { month: "2026-09", interestAccrued: 20_000, principalBalance: 400_000, scheduledTotal: 120_000, paidTotal: 120_000 },
    { month: "2026-10", interestAccrued: 18_000, principalBalance: 400_000, scheduledTotal: 118_000, paidTotal: 0 },
  ]);
});
