import assert from "node:assert/strict";
import test from "node:test";
import { aggregateDdsMonthlyFacts, aggregatePayrollMonthlyFacts, mergeMonthlySharedFacts } from "./monthlyFacts.ts";

test("ДДС раскладывается по статьям ОПиУ и не дублирует платежи ведомости", () => {
  const result = aggregateDdsMonthlyFacts([
    { amount: -100, category: "РКО" },
    { amount: -50, category: "РКО" },
    { amount: -70, category: "Расходы на персонал", comment: "[payroll:entry-1] Налог" },
    { amount: -30, category: "Расходы на персонал", comment: "Подарок сотруднику" },
    { amount: 200, category: "РКО" },
  ]);
  assert.equal(result.bank_fees.amount, 150);
  assert.equal(result.personnel.amount, 30);
});

test("полный месяц ведомости даёт начисленный административный и коммерческий ФОТ", () => {
  const result = aggregatePayrollMonthlyFacts({
    from: "2026-09-01",
    to: "2026-09-30",
    periods: [
      { id: "p1", periodStart: "2026-09-01", periodEnd: "2026-09-15" },
      { id: "p2", periodStart: "2026-09-16", periodEnd: "2026-09-30" },
    ],
    employees: [
      { id: "e1", position: "Финансовый директор" },
      { id: "e2", position: "Менеджер WB" },
      { id: "e3", position: "Сотрудник склада" },
    ],
    entries: [
      { periodId: "p1", employeeId: "e1", officialAmount: 100, unofficialAmount: 0, contractorAmount: 0, taxAmount: 13 },
      { periodId: "p2", employeeId: "e2", officialAmount: 0, unofficialAmount: 80, contractorAmount: 0, taxAmount: 0 },
      { periodId: "p2", employeeId: "e3", officialAmount: 60, unofficialAmount: 0, contractorAmount: 0, taxAmount: 8 },
    ],
  });
  assert.deepEqual(result.admin_salary, { amount: 100, status: "complete", note: "Начисления зарплатной ведомости за полный месяц" });
  assert.equal(result.commercial_salary.amount, 80);
  assert.equal(result.payroll_taxes.amount, 21);
});

test("неполная ведомость не выдаётся за полный месяц", () => {
  const result = aggregatePayrollMonthlyFacts({
    from: "2026-09-01",
    to: "2026-09-30",
    periods: [{ id: "p1", periodStart: "2026-09-01", periodEnd: "2026-09-15" }],
    employees: [{ id: "e1", position: "Маркетолог" }],
    entries: [{ periodId: "p1", employeeId: "e1", officialAmount: 100, unofficialAmount: 0, contractorAmount: 0, taxAmount: 13 }],
  });
  assert.equal(result.commercial_salary.status, "partial");
  assert.match(result.commercial_salary.note ?? "", /не за весь месяц/);
});

test("несколько внутренних источников одной статьи суммируются", () => {
  const result = mergeMonthlySharedFacts(
    { fulfillment: { amount: 100, status: "complete" } },
    { fulfillment: { amount: 25, status: "partial", note: "часть актов" } },
  );
  assert.equal(result.fulfillment.amount, 125);
  assert.equal(result.fulfillment.status, "partial");
});
