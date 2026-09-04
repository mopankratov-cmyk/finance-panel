import assert from "node:assert/strict";
import test from "node:test";
import { canCloseRowsWithFact, canCloseRowWithFact, derivedPaymentForRow, scheduleDraftFromRows, scheduleRowFromDb, type ScheduleRowRecord } from "./scheduleRows.ts";

const row = (over: Partial<ScheduleRowRecord>): ScheduleRowRecord => ({
  id: "r1", loanId: "L", dueDate: "2026-10-01", kind: "interest", amountRub: 20_000, amountOriginal: null, currency: "RUB",
  status: "planned", paidByPaymentId: null, calendarPaymentId: null, originalDueDate: null, balanceBefore: 1_000_000, balanceAfter: 1_000_000, ...over,
});

test("строки одной даты сворачиваются в одну запись черновика со статусом по всем частям", () => {
  const draft = scheduleDraftFromRows([
    row({ id: "a", kind: "interest", amountRub: 20_000, status: "paid" }),
    row({ id: "b", kind: "principal", amountRub: 1_000_000, status: "planned", balanceAfter: 0 }),
    row({ id: "c", dueDate: "2026-09-01", kind: "interest", amountRub: 20_000, status: "paid" }),
  ]);
  assert.equal(draft.length, 2);
  assert.equal(draft[0].date, "2026-09-01");
  assert.equal(draft[0].status, "done");
  assert.equal(draft[1].principal, 1_000_000);
  assert.equal(draft[1].interest, 20_000);
  assert.equal(draft[1].status, "planned", "одна часть план — вся дата план");
  assert.equal(draft[1].balanceAfter, 0);
});

test("производный платёж несёт прежнюю метку и статью из справочника", () => {
  const payment = derivedPaymentForRow(row({ id: "r9", kind: "principal", amountRub: 500_000 }), { loanId: "L", creditorName: "Банк", accountId: "a", currency: "RUB", exchangeRate: 1 });
  assert.equal(payment.amount, -500_000);
  assert.equal(payment.category, "Погашение тела кредита");
  assert.match(payment.comment ?? "", /\[loan:L:schedule:r9:principal\]/);
  assert.equal(payment.status, "planned");
  const paid = derivedPaymentForRow(row({ status: "paid", paidByPaymentId: "f1" }), { loanId: "L", creditorName: "Банк", accountId: "a", currency: "RUB", exchangeRate: 1 });
  assert.equal(paid.status, "cancelled", "закрытая фактом строка — план отменён");
  assert.match(paid.comment ?? "", /\[paid-by:f1\]/);
  const manual = derivedPaymentForRow(row({ status: "paid" }), { loanId: "L", creditorName: "Банк", accountId: "a", currency: "RUB", exchangeRate: 1 });
  assert.equal(manual.status, "done", "оплачено без факта — план и есть факт");
});

test("закрытие фактом: занятый факт и расхождение суммы без подтверждения отклоняются", () => {
  const fact = { id: "f", status: "done" as const, amount: -20_000 };
  assert.equal(canCloseRowWithFact(row({}), fact, new Set(), false).ok, true);
  assert.equal(canCloseRowWithFact(row({}), fact, new Set(["f"]), false).ok, false);
  assert.equal(canCloseRowWithFact(row({}), { ...fact, amount: -15_000 }, new Set(), false).ok, false);
  assert.equal(canCloseRowWithFact(row({}), { ...fact, amount: -15_000 }, new Set(), true).ok, true, "с подтверждением — можно");
  assert.equal(canCloseRowWithFact(row({ status: "paid" }), fact, new Set(), true).ok, false);
  const parts = [row({ id: "p", kind: "principal", amountRub: 100_000 }), row({ id: "i", kind: "interest", amountRub: 20_000 })];
  assert.equal(canCloseRowsWithFact(parts, { id: "f", status: "done", amount: -120_000 }, new Set(), false).ok, true, "одна дата — тело+проценты — один факт");
  assert.equal(canCloseRowsWithFact(parts, { id: "f", status: "done", amount: -100_000 }, new Set(), false).ok, false);
});

test("строка из базы читается с безопасными значениями", () => {
  const record = scheduleRowFromDb({ id: "x", loan_id: "L", due_date: "2026-10-01T00:00:00", kind: "weird", amount_rub: "10.5", status: "nope" });
  assert.equal(record.kind, "interest");
  assert.equal(record.status, "planned");
  assert.equal(record.amountRub, 10.5);
  assert.equal(record.dueDate, "2026-10-01");
});
