import assert from "node:assert/strict";
import test from "node:test";
import { aggregateRecognizedSchedule, recognizeLoanSpreadsheet } from "@/components/loans/loanRecognition";

test("loan schedule sums every payment component falling on the same date", () => {
  assert.deepEqual(aggregateRecognizedSchedule([
    { date: "2027-07-24", principal: 0, interest: 4_340.58 },
    { date: "2027-07-24", principal: 0, interest: 1_825.77 },
    { date: "2027-07-24", principal: 764_360.4, interest: 0 },
    { date: "2027-07-24", principal: 0, interest: 0, penalty: 14_095.59 },
  ]), [{
    date: "2027-07-24",
    principal: 764_360.4,
    interest: 6_166.35,
    penalty: 14_095.59,
  }]);
});

test("loan schedule keeps different dates separate and ordered", () => {
  assert.deepEqual(aggregateRecognizedSchedule([
    { date: "2026-09-02", principal: 20, interest: 2 },
    { date: "2026-08-02", principal: 10, interest: 1 },
  ]).map((row) => row.date), ["2026-08-02", "2026-09-02"]);
});

test("bank spreadsheet parser classifies and sums same-date schedule components", () => {
  const result = recognizeLoanSpreadsheet([
    ["Кредит Сбербанк ООО РИО", "", "Дата займа 21.09.2023"],
    ["№", "Тип плановой операции", "Дата платежа", "Плановая сумма"],
    ["1", "Погашение процентов", "46587", "42005,60"],
    ["2", "Погашение ссудной задолженности", "46587", "764360,40"],
    ["3", "Погашение неустойки за просроченный кредит", "46587", "11063,31"],
  ]);
  assert.equal(result.creditorName, "Сбербанк");
  assert.equal(result.companyHint, "ООО РИО");
  assert.deepEqual(result.schedule, [{
    date: "2027-07-19",
    principal: 764_360.4,
    interest: 42_005.6,
    penalty: 11_063.31,
  }]);
});
