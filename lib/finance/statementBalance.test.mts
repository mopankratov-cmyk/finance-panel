import assert from "node:assert/strict";
import test from "node:test";
import { connectedBalanceTotals, loanLiabilitySnapshot } from "./statementBalance.ts";
import type { ScheduleRowRecord } from "../loans/scheduleRows.ts";
import type { Loan } from "../types.ts";

const loan = (id: string, principalAmount: number): Loan => ({
  id,
  creditorName: `Кредитор ${id}`,
  principalAmount,
  interestRatePerDay: 0,
  startDate: "2026-01-01",
  dueDate: "2026-12-31",
  status: "active",
});

const row = (loanId: string, dueDate: string, amountRub: number, status: ScheduleRowRecord["status"]): ScheduleRowRecord => ({
  id: `${loanId}-${dueDate}`,
  loanId,
  dueDate,
  kind: "principal",
  amountRub,
  amountOriginal: amountRub,
  currency: "RUB",
  status,
  paidByPaymentId: status === "paid" ? "fact" : null,
  calendarPaymentId: null,
  originalDueDate: null,
  balanceBefore: null,
  balanceAfter: null,
});

test("обязательство уменьшается только на оплаченное тело к выбранной дате", () => {
  const snapshot = loanLiabilitySnapshot(
    [loan("a", 1_000_000)],
    [row("a", "2026-02-01", 250_000, "paid"), row("a", "2026-10-01", 750_000, "planned")],
    "2026-09-24",
  );
  assert.equal(snapshot.amount, 750_000);
  assert.equal(snapshot.estimatedCount, 0);
});

test("договор без графика не пропадает и отмечается оценкой", () => {
  const snapshot = loanLiabilitySnapshot([loan("legacy", 420_000)], [], "2026-09-24");
  assert.equal(snapshot.amount, 420_000);
  assert.equal(snapshot.estimatedCount, 1);
  assert.equal(snapshot.details[0].estimated, true);
});

test("итоги строятся только по подключённым статьям", () => {
  assert.deepEqual(connectedBalanceTotals({ cash: 600_000, inventory: 400_000, loans: 250_000 }), {
    assets: 1_000_000,
    liabilities: 250_000,
    calculatedEquity: 750_000,
    debtShare: 0.25,
    autonomy: 0.75,
  });
});
