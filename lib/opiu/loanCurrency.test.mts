import assert from "node:assert/strict";
import test from "node:test";
import { originalLoanPaymentAmount, recalculatePlannedLoanPayment, roundToTenth } from "./loanCurrency.ts";

const payment = {
  id: "p1", date: "2026-09-10", name: "Проценты", amount: -51271.023,
  category: "Проценты по кредитам и займам", accountId: "a1", status: "planned" as const,
  counterparty: "Новиков", comment: "[loan:l1:schedule:r1:interest] [currency:USD] [fx-rate:80] [amount-original:640]",
};

test("денежные значения округляются до одного знака", () => {
  assert.equal(roundToTenth(51271.023), 51271);
  assert.equal(roundToTenth(51271.06), 51271.1);
});

test("плановый валютный платёж пересчитывается, исходная сумма сохраняется", () => {
  const updated = recalculatePlannedLoanPayment(payment, 82.5, "2026-09-01");
  assert.equal(updated?.amount, -52800);
  assert.equal(originalLoanPaymentAmount(updated!, 82.5), 640);
  assert.match(updated?.comment ?? "", /\[fx-rate-date:2026-09-01\]/);
});

test("оплаченный валютный платёж не пересчитывается", () => {
  assert.equal(recalculatePlannedLoanPayment({ ...payment, status: "done" }, 90, "2026-09-01"), null);
});

test("старый валютный график без исходной суммы восстанавливается по сохранённому курсу", () => {
  assert.ok(Math.abs(originalLoanPaymentAmount({ ...payment, comment: "[currency:USD] [fx-rate:80]" }, 80) - 640.8877875) < 1e-9);
});
