import assert from "node:assert/strict";
import test from "node:test";
import type { Payment } from "../../lib/types.ts";
import {
  isLoanInstallmentAwaitingReschedule,
  overdueLoanInstallmentsForReview,
  rescheduleOverdueLoanInstallment,
} from "./loanPaymentReschedule.ts";

const payment = (id: string, kind: "principal" | "interest", date = "2026-08-16"): Payment => ({
  id,
  date,
  name: kind === "principal" ? "Погашение тела — Банк" : "Проценты по кредиту — Банк",
  amount: kind === "principal" ? -100_000 : -15_000,
  category: kind === "principal" ? "Погашение тела кредита" : "Проценты по кредитам и займам",
  accountId: "account-1",
  status: "planned",
  counterparty: "Банк",
  comment: `[loan:loan-1:schedule:row-1:${kind}]`,
});

test("overdue loan parts are grouped for manual review without changing their dates", () => {
  const payments = [payment("principal", "principal"), payment("interest", "interest")];
  const queue = overdueLoanInstallmentsForReview(payments, "2026-09-02");

  assert.equal(queue.length, 1);
  assert.equal(queue[0].dueDate, "2026-08-16");
  assert.equal(queue[0].total, 115_000);
  assert.deepEqual(payments.map((item) => item.date), ["2026-08-16", "2026-08-16"]);
});

test("previously auto-moved overdue payment still enters the manual queue", () => {
  const moved = {
    ...payment("interest", "interest", "2026-09-02"),
    comment: `${payment("interest", "interest").comment} [original-due:2026-08-16]`,
  };

  assert.equal(isLoanInstallmentAwaitingReschedule(moved, "2026-09-02"), true);
  assert.equal(overdueLoanInstallmentsForReview([moved], "2026-09-02")[0].dueDate, "2026-08-16");
});

test("payment returns to the calendar only after a valid date is confirmed", () => {
  const payments = [payment("principal", "principal"), payment("interest", "interest")];
  const installment = overdueLoanInstallmentsForReview(payments, "2026-09-02")[0];

  assert.deepEqual(rescheduleOverdueLoanInstallment(payments, installment, "2026-09-01", "2026-09-02"), []);
  const updated = rescheduleOverdueLoanInstallment(payments, installment, "2026-09-10", "2026-09-02");

  assert.equal(updated.length, 2);
  assert.ok(updated.every((item) => item.date === "2026-09-10"));
  assert.ok(updated.every((item) => item.comment?.includes("[original-due:2026-08-16]")));
  assert.ok(updated.every((item) => item.comment?.includes("[overdue-calendar-date:2026-09-10]")));
  assert.ok(updated.every((item) => !isLoanInstallmentAwaitingReschedule(item, "2026-09-02")));
  assert.ok(updated.every((item) => isLoanInstallmentAwaitingReschedule(item, "2026-09-11")));
});

test("paid and cancelled loan payments are not shown in the overdue queue", () => {
  const paid = { ...payment("paid", "interest"), status: "done" as const };
  const cancelled = { ...payment("cancelled", "principal"), status: "cancelled" as const };
  assert.deepEqual(overdueLoanInstallmentsForReview([paid, cancelled], "2026-09-02"), []);
});
