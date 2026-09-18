import assert from "node:assert/strict";
import test from "node:test";
import { aggregateDdsMonthlyFacts, aggregateLoanScheduleMonthlyFacts, aggregatePayrollMonthlyFacts, mergeMonthlySharedFacts } from "./monthlyFacts.ts";

test("ДДС раскладывается по статьям ОПиУ и не дублирует платежи ведомости", () => {
  const result = aggregateDdsMonthlyFacts([
    { amount: -100, category: "РКО", status: "done", importSource: "bank-review:1" },
    { amount: -50, category: "РКО", status: "done", importSource: "dds-chain:1:1" },
    { amount: -70, category: "Расходы на персонал", comment: "[payroll:entry-1] Налог", status: "done", importSource: "bank-review:2" },
    { amount: -30, category: "Расходы на персонал", comment: "Подарок сотруднику", status: "done", importSource: "manual-dds:1" },
    { amount: 200, category: "РКО", status: "done", importSource: "bank-review:3" },
  ]);
  assert.equal(result.bank_fees.amount, 150);
  assert.equal(result.personnel.amount, 30);
});

test("ОПиУ не принимает завершённые технические строки платёжного календаря за факт ДДС", () => {
  const result = aggregateDdsMonthlyFacts([
    { amount: -100, category: "РКО", status: "done", importSource: "bank-review:1" },
    { amount: -900, category: "РКО", status: "done", importSource: null },
    { amount: -700, category: "РКО", status: "planned", importSource: "manual-dds:2" },
  ]);
  assert.equal(result.bank_fees.amount, 100);
});

test("налоги и проценты из ДДС не дублируют расчёты ОПиУ, а проценты берутся из графика", () => {
  const dds = aggregateDdsMonthlyFacts([
    { amount: -1_000, category: "УСН", status: "done", importSource: "bank-review:tax" },
    { amount: -700, category: "Проценты по кредитам и займам", status: "done", importSource: "bank-review:loan" },
  ]);
  const loans = aggregateLoanScheduleMonthlyFacts([
    { amount: 500, kind: "interest", status: "planned", companyId: "company-a" },
    { amount: 100, kind: "fee", status: "paid", companyId: "company-a" },
    { amount: 900, kind: "interest", status: "cancelled", companyId: "company-a" },
  ], ["company-a"]);
  assert.equal(dds.taxes, undefined);
  assert.equal(dds.loan_interest, undefined);
  assert.equal(loans.loan_interest.amount, 500);
});

test("даже пользовательская статья ДДС не подменяет расчёт налогов и процентов", () => {
  const result = aggregateDdsMonthlyFacts([
    { amount: -1_000, category: "Мой налог", status: "done", importSource: "manual-dds:tax" },
  ], [{ id: "custom-tax", name: "Мой налог", opiuArticleId: "taxes" }]);
  assert.equal(result.taxes, undefined);
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

test("зарплата выбранной компании берётся из строк распределения", () => {
  const result = aggregatePayrollMonthlyFacts({
    from: "2026-09-01",
    to: "2026-09-30",
    companyId: "company-a",
    periods: [{ id: "p1", periodStart: "2026-09-01", periodEnd: "2026-09-30" }],
    employees: [{ id: "e1", position: "Финансовый директор" }],
    entries: [{
      periodId: "p1",
      employeeId: "e1",
      officialAmount: 300,
      unofficialAmount: 0,
      contractorAmount: 0,
      taxAmount: 39,
      lines: [
        { amount: 100, taxAmount: 13, companyId: "company-a" },
        { amount: 200, taxAmount: 26, companyId: "company-b" },
      ],
    }],
  });
  assert.equal(result.admin_salary.amount, 100);
  assert.equal(result.payroll_taxes.amount, 13);
});

test("алиасы одного юрлица объединяют начисления обеих исторических карточек", () => {
  const result = aggregatePayrollMonthlyFacts({
    from: "2026-09-01",
    to: "2026-09-30",
    companyIds: ["korovkin", "filippov"],
    periods: [{ id: "p1", periodStart: "2026-09-01", periodEnd: "2026-09-30" }],
    employees: [{ id: "e1", position: "Финансовый директор" }],
    entries: [{
      periodId: "p1",
      employeeId: "e1",
      officialAmount: 300,
      unofficialAmount: 0,
      contractorAmount: 0,
      taxAmount: 39,
      lines: [
        { amount: 100, taxAmount: 13, companyId: "korovkin" },
        { amount: 200, taxAmount: 26, companyId: "filippov" },
      ],
    }],
  });
  assert.equal(result.admin_salary.amount, 300);
  assert.equal(result.payroll_taxes.amount, 39);
});
