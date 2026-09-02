import assert from "node:assert/strict";
import test from "node:test";
import { chronologicalPaymentOrder, displayPaymentComment, editablePaymentComment } from "./paymentPriority.ts";

const technical = "[loan:abc:schedule:row:principal] [origination-fee:0] [fee-months:36] [contract:ИП Панкратов JetLend займ № 22612 обновленный.pdf] [priority:A]";

test("технические маркеры превращаются в читаемый комментарий", () => {
  assert.equal(displayPaymentComment(technical), "Договор: ИП Панкратов JetLend займ № 22612 обновленный.pdf");
});

test("в поле редактирования остаётся только пользовательский текст", () => {
  assert.equal(editablePaymentComment(`Платёж по договору ${technical}`), "Платёж по договору");
});

test("платежи идут от новой даты к старой независимо от приоритета", () => {
  const payments = [
    { date: "2026-10-21", amount: -500_000, category: "Зарплата", name: "Поздний", comment: "[priority:A]" },
    { date: "2026-09-23", amount: -500_000, category: "Прочее", name: "Ранний", comment: "[priority:C]" },
    { date: "2026-10-07", amount: -500_000, category: "Зарплата", name: "Средний", comment: "[priority:A]" },
  ].sort(chronologicalPaymentOrder);
  assert.deepEqual(payments.map((payment) => payment.date), ["2026-10-21", "2026-10-07", "2026-09-23"]);
});
