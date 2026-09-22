import assert from "node:assert/strict";
import test from "node:test";
import type { ScheduleRowRecord } from "../../lib/loans/scheduleRows";
import type { Loan, Payment } from "../../lib/types";
import { cashLoanScheduleOptions, closestCashLoanScheduleOption, isLoanRepaymentCategory, loanPaymentNeedsConfirmation } from "./cashLoanScheduleLink";

const loan: Loan = { id: "loan-1", creditorName: "Банк", principalAmount: 100_000, interestRatePerDay: 0, startDate: "2026-01-01", dueDate: "2026-12-31", status: "active" };
const plan = (overrides: Partial<Payment>): Payment => ({ id: "p", date: "2026-10-10", name: "План", amount: -1_000, category: "Погашение тела кредита", accountId: "a", status: "planned", counterparty: "Банк", comment: "[loan:loan-1:schedule:old:principal]", ...overrides });
const row = (overrides: Partial<ScheduleRowRecord>): ScheduleRowRecord => ({ id: "r", loanId: "loan-1", dueDate: "2026-10-10", kind: "principal", amountRub: 10_000, amountOriginal: null, currency: "RUB", status: "planned", paidByPaymentId: null, calendarPaymentId: null, originalDueDate: null, balanceBefore: null, balanceAfter: null, ...overrides });

test("статья тела кредита предлагает только неоплаченное тело той же даты", () => {
  const options = cashLoanScheduleOptions({
    loans: [loan],
    payments: [plan({ id: "company-marker", companyId: "c1" })],
    paymentCompanies: new Map([["company-marker", "c1"]]),
    scheduleRows: [row({ id: "principal" }), row({ id: "interest", kind: "interest", amountRub: 500 }), row({ id: "paid", dueDate: "2026-11-10", status: "paid" })],
    category: "Погашение тела кредита",
  });
  assert.equal(options.length, 1);
  assert.deepEqual(options[0].rowIds, ["principal"]);
  assert.equal(options[0].companyId, "c1");
  assert.equal(options[0].amount, 10_000);
});

test("общая статья собирает все части платежа на дату", () => {
  const options = cashLoanScheduleOptions({
    loans: [loan], payments: [], paymentCompanies: new Map(),
    scheduleRows: [row({ id: "principal" }), row({ id: "interest", kind: "interest", amountRub: 500 })],
    category: "Оплаты по кредитам и займам",
  });
  assert.deepEqual(options[0].rowIds, ["principal", "interest"]);
  assert.equal(options[0].amount, 10_500);
});

test("старый график без новой таблицы остаётся доступен", () => {
  const options = cashLoanScheduleOptions({ loans: [loan], payments: [plan({ id: "legacy" })], paymentCompanies: new Map(), scheduleRows: [], category: "Погашение тела кредита" });
  assert.deepEqual(options[0].legacyPaymentIds, ["legacy"]);
});

test("распознаются только расходные кредитные статьи и расхождение свыше одного процента", () => {
  assert.equal(isLoanRepaymentCategory("Погашение тела кредита"), true);
  assert.equal(isLoanRepaymentCategory("Получение кредитов и займов"), false);
  assert.equal(loanPaymentNeedsConfirmation(10_100, 10_000), false);
  assert.equal(loanPaymentNeedsConfirmation(10_101, 10_000), true);
});

test("для кредита предлагается ближайший платёж по дате, затем по сумме", () => {
  const base = { key: "a", loanId: "loan-1", loanName: "Банк", companyId: "c1", amount: 10_000, rowIds: ["r"], legacyPaymentIds: [], label: "" };
  const selected = closestCashLoanScheduleOption([
    { ...base, key: "later", dueDate: "2026-10-20", amount: 9_000 },
    { ...base, key: "near-wrong", dueDate: "2026-10-11", amount: 12_000 },
    { ...base, key: "near-exact", dueDate: "2026-10-11", amount: 10_000 },
  ], "2026-10-10", 10_000);
  assert.equal(selected?.key, "near-exact");
});

test("одноимённые кредиты различаются датой начала и исходной суммой", () => {
  const secondLoan = { ...loan, id: "loan-2", startDate: "2026-02-03", principalAmount: 250_000 };
  const options = cashLoanScheduleOptions({
    loans: [loan, secondLoan], payments: [], paymentCompanies: new Map(),
    scheduleRows: [row({ loanId: "loan-1", id: "r1" }), row({ loanId: "loan-2", id: "r2" })],
    category: "Погашение тела кредита",
  });
  assert.equal(new Set(options.map((item) => item.loanName)).size, 2);
  assert.match(options.find((item) => item.loanId === "loan-1")?.loanName ?? "", /01\.01\.2026.*100\s000 ₽/);
  assert.match(options.find((item) => item.loanId === "loan-2")?.loanName ?? "", /03\.02\.2026.*250\s000 ₽/);
});
