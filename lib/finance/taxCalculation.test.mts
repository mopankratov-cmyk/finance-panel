import assert from "node:assert/strict";
import test from "node:test";
import { calculateTaxPeriod, parsePaymentVat } from "./taxCalculation.ts";

test("распознаёт явную сумму НДС из назначения платежа", () => {
  assert.deepEqual(parsePaymentVat("Оплата услуг, в т.ч. НДС 22% 18 032,79 руб.", -100_000), {
    rate: 22, amount: 18_032.79, kind: "explicit",
  });
});

test("ставка без суммы даёт только расчётную подсказку", () => {
  assert.deepEqual(parsePaymentVat("Оплата по договору, НДС 20%", -120_000), {
    rate: 20, amount: 20_000, kind: "calculated",
  });
});

test("специальная ставка НДС не разрешает входной вычет", () => {
  const result = calculateTaxPeriod({
    taxSystem: "usn_income_expense", taxRate: 15, vatMode: "5",
    marketplaceIncomeGross: 105_000, marketplaceExpensesGross: 20_000,
    bankExpenses: [{ grossAmount: 12_200, vatAmount: 2_200, vatDocumentStatus: "received", vatDeductionStatus: "eligible", usnExpenseStatus: "included" }],
  });
  assert.equal(result.outputVat, 5_000);
  assert.equal(result.confirmedInputVat, 0);
  assert.equal(result.usnIncome, 100_000);
  assert.equal(result.usnExpenses, 32_200);
  assert.equal(result.usnCalculated, 10_170);
  assert.equal(result.usnBeforeReduction, 10_170);
});

test("при общей ставке подтверждённый входной НДС вычитается и из НДС, и из расхода УСН", () => {
  const result = calculateTaxPeriod({
    taxSystem: "usn_income_expense", taxRate: 15, vatMode: "22",
    marketplaceIncomeGross: 122_000, marketplaceExpensesGross: 24_400, marketplaceInputVatConfirmed: 4_400,
    bankExpenses: [{ grossAmount: 12_200, vatAmount: 2_200, vatDocumentStatus: "received", vatDeductionStatus: "eligible", usnExpenseStatus: "included" }],
  });
  assert.equal(result.outputVat, 22_000);
  assert.equal(result.confirmedInputVat, 6_600);
  assert.equal(result.vatPayable, 15_400);
  assert.equal(result.usnExpenses, 30_000);
  assert.equal(result.usnCalculated, 10_500);
  assert.equal(result.minimumTaxControl, 1_000);
});

test("УСН Доходы уменьшается на взносы отдельно от официальной ставки", () => {
  const result = calculateTaxPeriod({
    taxSystem: "usn_income", taxRate: 1, vatMode: "5",
    marketplaceIncomeGross: 1_050_000, marketplaceExpensesGross: 0,
    insuranceContributions: 57_390, insuranceReductionLimitPercent: 100,
    bankExpenses: [],
  });
  assert.equal(result.usnIncome, 1_000_000);
  assert.equal(result.usnBeforeReduction, 10_000);
  assert.equal(result.insuranceContributionsApplied, 10_000);
  assert.equal(result.usnCalculated, 0);
});

test("для работодателя уменьшение УСН Доходы ограничено 50 процентами", () => {
  const result = calculateTaxPeriod({
    taxSystem: "usn_income", taxRate: 6, vatMode: "exempt",
    marketplaceIncomeGross: 1_000_000, marketplaceExpensesGross: 0,
    insuranceContributions: 100_000, insuranceReductionLimitPercent: 50,
    bankExpenses: [],
  });
  assert.equal(result.usnBeforeReduction, 60_000);
  assert.equal(result.insuranceContributionsApplied, 30_000);
  assert.equal(result.usnCalculated, 30_000);
});

test("взносы и убыток прошлых лет уменьшают базу УСН Доходы минус расходы", () => {
  const result = calculateTaxPeriod({
    taxSystem: "usn_income_expense", taxRate: 15, vatMode: "exempt",
    marketplaceIncomeGross: 1_000_000, marketplaceExpensesGross: 400_000,
    insuranceContributions: 50_000, priorYearLoss: 100_000,
    bankExpenses: [],
  });
  assert.equal(result.usnExpenses, 450_000);
  assert.equal(result.usnBase, 450_000);
  assert.equal(result.usnCalculated, 67_500);
});

test("отрицательный баланс НДС показывается как перенос, а не теряется", () => {
  const result = calculateTaxPeriod({
    taxSystem: "usn_income_expense", taxRate: 15, vatMode: "22",
    marketplaceIncomeGross: 122_000, marketplaceExpensesGross: 244_000,
    marketplaceInputVatConfirmed: 44_000, bankExpenses: [],
  });
  assert.equal(result.vatPayable, 0);
  assert.equal(result.vatCarryforward, 22_000);
});

test("точный исходящий НДС заменяет оценку по единой ставке", () => {
  const result = calculateTaxPeriod({
    taxSystem: "usn_income", taxRate: 6, vatMode: "22",
    marketplaceIncomeGross: 122_000, outputVatConfirmed: 12_000,
    marketplaceExpensesGross: 0, bankExpenses: [],
  });
  assert.equal(result.outputVat, 12_000);
  assert.equal(result.usnIncome, 110_000);
});

test("дата начала НДС ограничивает только базу НДС, но не доход УСН", () => {
  const result = calculateTaxPeriod({
    taxSystem: "usn_income_expense", taxRate: 15, vatMode: "22",
    marketplaceIncomeGross: 222_000, vatTaxableIncomeGross: 122_000,
    marketplaceExpensesGross: 0, bankExpenses: [],
  });
  assert.equal(result.outputVat, 22_000);
  assert.equal(result.usnIncome, 200_000);
  assert.equal(result.usnCalculated, 30_000);
});
