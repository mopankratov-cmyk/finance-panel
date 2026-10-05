import assert from "node:assert/strict";
import test from "node:test";
import { payrollEmployeeSuggestion } from "./employeeSuggestion.ts";

const employees = [
  { id: "efremova", fullName: "Ефремова Алина Михайловна" },
  { id: "timoshina", fullName: "Тимошина Евгения Николаевна" },
  { id: "smirnov", fullName: "Смирнов Дмитрий Владимирович" },
];

test("подбирает сотрудника по сокращённому ФИО из выписки", () => {
  assert.equal(payrollEmployeeSuggestion({ counterparty: "Алина Михайловна Е." }, employees), "efremova");
  assert.equal(payrollEmployeeSuggestion({ counterparty: "Евгения Николаевна Т." }, employees), "timoshina");
  assert.equal(payrollEmployeeSuggestion({ counterparty: "Дмитрий Владимирович С." }, employees), "smirnov");
});

test("не угадывает сотрудника по неполному совпадению", () => {
  assert.equal(payrollEmployeeSuggestion({ counterparty: "Алина Е." }, employees), null);
});
