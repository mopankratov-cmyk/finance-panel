import assert from "node:assert/strict";
import test from "node:test";
import { appendPayrollFactMarker, canAllocateFactToPayroll, employeeDebt, paymentIsPayrollCandidate, payrollCategoryForEmployee } from "./model.ts";

test("зарплата резервирует факт один раз и допускает продолжение частичного распределения", () => {
  assert.equal(appendPayrollFactMarker("Перевод сотруднику", "fact-1"), "Перевод сотруднику [payroll-paid:fact-1]");
  assert.equal(appendPayrollFactMarker("[payroll-paid:fact-1]", "fact-1"), "[payroll-paid:fact-1]");
  assert.equal(canAllocateFactToPayroll("fact-1", new Set(["fact-1"]), 0), false);
  assert.equal(canAllocateFactToPayroll("fact-1", new Set(["fact-1"]), 1000), true);
});

test("долг считается только при наличии начислений", () => {
  assert.equal(employeeDebt(null, 0), null);
  assert.equal(employeeDebt(100_000, 40_000), 60_000);
  assert.equal(employeeDebt(10_000, 12_000), 0);
});

test("в очередь ведомости попадают только явно отмеченные в ДДС зарплатные операции", () => {
  assert.equal(paymentIsPayrollCandidate({ status: "done", amount: -10_000, date: "2026-09-01", category: "Зарплата административного персонала" }), true);
  assert.equal(paymentIsPayrollCandidate({ status: "done", amount: -10_000, date: "2026-09-01", category: "Зарплата" }), false);
  assert.equal(paymentIsPayrollCandidate({ status: "done", amount: -10_000, date: "2026-09-01", category: "Расходы на персонал" }), false);
  assert.equal(paymentIsPayrollCandidate({ status: "done", amount: -10_000, date: "2026-09-01", category: "" }), false);
  assert.equal(paymentIsPayrollCandidate({ status: "done", amount: -10_000, date: "2026-08-31", category: "Зарплата" }), false);
  assert.equal(paymentIsPayrollCandidate({ status: "planned", amount: -10_000, date: "2026-09-01", category: "Зарплата" }), false);
});

test("статья зарплаты определяется единообразно по роли", () => {
  assert.equal(payrollCategoryForEmployee("Менеджер Ozon"), "commercial");
  assert.equal(payrollCategoryForEmployee("Сотрудник склада"), "production");
  assert.equal(payrollCategoryForEmployee("Финансовый директор"), "administrative");
});
