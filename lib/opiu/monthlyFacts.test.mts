import assert from "node:assert/strict";
import test from "node:test";
import { aggregateDdsMonthlyFacts, aggregateLoanScheduleMonthlyFacts, aggregatePayrollMonthlyFacts, loanCompanyByReceiptPayments, mergeMonthlySharedFacts, payrollMonthlyContributions } from "./monthlyFacts.ts";

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

test("компания кредита восстанавливается по платежу получения договора", () => {
  const companies = loanCompanyByReceiptPayments([
    { companyId: "company-rio", comment: "[loan:11111111-1111-4111-8111-111111111111:receipt]" },
    { companyId: null, comment: "[loan:22222222-2222-4222-8222-222222222222:receipt]" },
    { companyId: "company-other", comment: "обычный платёж" },
  ]);
  assert.equal(companies.get("11111111-1111-4111-8111-111111111111"), "company-rio");
  assert.equal(companies.has("22222222-2222-4222-8222-222222222222"), false);
});

test("не угадывает компанию договора при конфликтующих привязках", () => {
  const companies = loanCompanyByReceiptPayments([
    { companyId: "company-a", comment: "[loan:11111111-1111-4111-8111-111111111111:receipt]" },
    { companyId: "company-b", comment: "[loan:11111111-1111-4111-8111-111111111111:receipt]" },
    { companyId: "company-a", comment: "[loan:11111111-1111-4111-8111-111111111111:receipt]" },
  ]);
  assert.equal(companies.has("11111111-1111-4111-8111-111111111111"), false);
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

test("август включает начисления за обе половины месяца, включая выплату 5 сентября", () => {
  const result = aggregatePayrollMonthlyFacts({
    from: "2026-08-01",
    to: "2026-08-31",
    periods: [
      { id: "paid-2026-08-20", periodStart: "2026-08-01", periodEnd: "2026-08-15" },
      { id: "paid-2026-09-05", periodStart: "2026-08-16", periodEnd: "2026-08-31" },
    ],
    employees: [{ id: "e1", position: "Финансовый директор", employmentType: "official" }],
    entries: [
      { periodId: "paid-2026-08-20", employeeId: "e1", officialAmount: 40_000, unofficialAmount: 0, contractorAmount: 0, taxAmount: 12_000 },
      { periodId: "paid-2026-09-05", employeeId: "e1", officialAmount: 50_000, unofficialAmount: 0, contractorAmount: 0, taxAmount: 15_000 },
    ],
  });
  assert.equal(result.admin_salary.amount, 90_000);
  assert.equal(result.payroll_taxes.amount, 27_000);
  assert.equal(result.admin_salary.status, "complete");
});

test("налог подрядчика входит в зарплату, а налог официальной части — в налоги на ФОТ", () => {
  const result = aggregatePayrollMonthlyFacts({
    from: "2026-09-01",
    to: "2026-09-30",
    periods: [{ id: "p1", periodStart: "2026-09-01", periodEnd: "2026-09-30" }],
    employees: [{ id: "e1", position: "Финансовый директор", employmentType: "partial" }],
    entries: [{
      periodId: "p1",
      employeeId: "e1",
      officialAmount: 100_000,
      unofficialAmount: 20_000,
      contractorAmount: 50_000,
      taxAmount: 33_000,
      lines: [
        { kind: "official", amount: 100_000, taxAmount: 30_000 },
        { kind: "unofficial", amount: 20_000, taxAmount: 0 },
        { kind: "contractor", amount: 50_000, taxAmount: 3_000 },
      ],
    }],
  });
  assert.equal(result.admin_salary.amount, 173_000);
  assert.equal(result.payroll_taxes.amount, 30_000);
});

test("старая строка ИП без детализации включает налог в зарплатную статью", () => {
  const result = aggregatePayrollMonthlyFacts({
    from: "2026-09-01",
    to: "2026-09-30",
    periods: [{ id: "p1", periodStart: "2026-09-01", periodEnd: "2026-09-30" }],
    employees: [{ id: "e1", position: "Менеджер WB", employmentType: "individual_entrepreneur" }],
    entries: [{ periodId: "p1", employeeId: "e1", officialAmount: 0, unofficialAmount: 0, contractorAmount: 50_000, taxAmount: 3_000 }],
  });
  assert.equal(result.commercial_salary.amount, 53_000);
  assert.equal(result.payroll_taxes.amount, 0);
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

test("расшифровка ведомости использует ту же сумму, что и агрегат ОПиУ", () => {
  const employee = { id: "e1", position: "Финансовый директор", employmentType: "partial" as const };
  const entry = {
    id: "entry-1",
    periodId: "p1",
    employeeId: "e1",
    officialAmount: 300,
    unofficialAmount: 0,
    contractorAmount: 0,
    taxAmount: 39,
    lines: [
      { kind: "official" as const, amount: 100, taxAmount: 13, companyId: "company-a" },
      { kind: "contractor" as const, amount: 200, taxAmount: 12, companyId: "company-b" },
    ],
  };
  const contributions = payrollMonthlyContributions(entry, employee, ["company-b"]);
  const aggregate = aggregatePayrollMonthlyFacts({
    from: "2026-09-01",
    to: "2026-09-30",
    companyIds: ["company-b"],
    periods: [{ id: "p1", periodStart: "2026-09-01", periodEnd: "2026-09-30" }],
    employees: [employee],
    entries: [entry],
  });

  assert.equal(contributions.find((item) => item.articleId === "admin_salary")?.amount, aggregate.admin_salary.amount);
  assert.equal(contributions.find((item) => item.articleId === "payroll_taxes")?.amount, aggregate.payroll_taxes.amount);
});
