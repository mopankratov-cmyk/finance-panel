import assert from "node:assert/strict";
import test from "node:test";
import { chronologicalPaymentOrder, displayPaymentComment, displayPaymentLabel, editablePaymentComment, getPaymentPriority, plannedExpensePrioritySummary } from "./paymentPriority.ts";

const technical = "[loan:abc:schedule:row:principal] [origination-fee:0] [fee-months:36] [contract:ИП Панкратов JetLend займ № 22612 обновленный.pdf] [priority:A]";

test("технические маркеры превращаются в читаемый комментарий", () => {
  assert.equal(displayPaymentComment(technical), "Договор: ИП Панкратов JetLend займ № 22612 обновленный.pdf");
});

test("в поле редактирования остаётся только пользовательский текст", () => {
  assert.equal(editablePaymentComment(`Платёж по договору ${technical}`), "Платёж по договору");
});

test("календарь показывает получателя раньше служебного комментария серии", () => {
  assert.equal(displayPaymentLabel({ name: "Алексею Хлестову", comment: "[recurring:weekly] · weekly, платёж 1", counterparty: "", category: "Оплата % по кредиту" }), "Алексею Хлестову");
});

test("обязательный платёж остаётся критичным при устаревшем маркере C", () => {
  assert.equal(getPaymentPriority({ name: "Алексею Хлестову", category: "Оплата % по кредиту", comment: "[priority:C]" }), "A");
  assert.equal(getPaymentPriority({ name: "Долг по ЗП", category: "Прочее", comment: "[priority:C]" }), "A");
  assert.equal(getPaymentPriority({ name: "Налоги Кристина", category: "Прочее", comment: "[priority:C]" }), "A");
});

test("сводка приоритетов считает только плановые расходы", () => {
  const summary = plannedExpensePrioritySummary([
    { status: "planned", amount: -30_000, date: "2026-10-08", name: "Алексею Хлестову", category: "Оплата % по кредиту", comment: "[priority:C]" },
    { status: "done", amount: -30_000, date: "2026-10-01", name: "Факт", category: "Оплата % по кредиту", comment: "[priority:A]" },
    { status: "planned", amount: 100_000, date: "2026-10-01", name: "Поступление", category: "Продажи", comment: "[priority:A]" },
    { status: "cancelled", amount: -50_000, date: "2026-09-01", name: "Отмена", category: "Налоги", comment: "[priority:A]" },
  ], "2026-10-10");

  assert.deepEqual(summary, [
    { priority: "A", count: 1, plannedExpense: 30_000, overdue: 1 },
    { priority: "B", count: 0, plannedExpense: 0, overdue: 0 },
    { priority: "C", count: 0, plannedExpense: 0, overdue: 0 },
  ]);
});

test("платежи идут от новой даты к старой независимо от приоритета", () => {
  const payments = [
    { date: "2026-10-21", amount: -500_000, category: "Зарплата", name: "Поздний", comment: "[priority:A]" },
    { date: "2026-09-23", amount: -500_000, category: "Прочее", name: "Ранний", comment: "[priority:C]" },
    { date: "2026-10-07", amount: -500_000, category: "Зарплата", name: "Средний", comment: "[priority:A]" },
  ].sort(chronologicalPaymentOrder);
  assert.deepEqual(payments.map((payment) => payment.date), ["2026-10-21", "2026-10-07", "2026-09-23"]);
});
