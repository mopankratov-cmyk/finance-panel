import assert from "node:assert/strict";
import test from "node:test";
import { aggregateRecognizedSchedule, recognizeLoanDocumentSchedule, recognizeLoanSpreadsheet, recognizeLoanText } from "./loanRecognition.ts";

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
    fine: 0,
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
    fine: 0,
  }]);
});

test("Word contract schedule keeps exact principal and interest columns", () => {
  const schedule = recognizeLoanDocumentSchedule(`
    Дата Остаток ссудной задолженности Проценты Ссудная задолженность Платеж
    01.12.2024 9 801 428,80р. 179 692,86р. 202 211,67р. 381 904,53р.
    01.01.2025 9 599 217,13р. 175 985,65р. 205 918,88р. 381 904,53р.
  `);
  assert.deepEqual(schedule, [
    { date: "2024-12-01", principal: 202_211.67, interest: 179_692.86, penalty: 0, fine: 0 },
    { date: "2025-01-01", principal: 205_918.88, interest: 175_985.65, penalty: 0, fine: 0 },
  ]);
});

test("monthly interest wording creates a monthly schedule without invented rows", () => {
  const result = recognizeLoanText("Заем 5 000 000 рублей от 09.10.2025 до 09.01.2026 под 38% годовых. Проценты выплачиваются ежемесячно.");
  assert.equal(result.interestFrequency, "monthly");
  assert.equal(result.principalAmount, 5_000_000);
  assert.equal(result.annualRate, 38);
  assert.equal(result.schedule, undefined);
});
