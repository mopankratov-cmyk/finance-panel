import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { statementFromGrid } from "./bankStatementGrid.ts";
import { xlsxGrid, xlsxText } from "./xlsxGrid.ts";

const file = readFileSync(new URL("../../tests/fixtures/bank-statement-mini.xlsx", import.meta.url));

test("выписка XLSX разбирается на сервере: строки, знаки, владелец, счёт, контрольные суммы", () => {
  const statement = statementFromGrid(xlsxGrid(file), xlsxText(file), "hash");
  assert.equal(statement.rows.length, 3);
  assert.deepEqual(statement.rows.map((row) => [row.date, row.amount]), [
    ["2027-08-01", -15000.5],
    ["2027-08-02", 250000],
    ["2027-08-03", -40000],
  ]);
  assert.equal(statement.owner, "ИП Иванов Иван Иванович");
  assert.equal(statement.ownerInn, "123456789012");
  assert.equal(statement.accountNumber, "40702810900000001234");
  assert.equal(statement.rows[0].counterparty, "ООО Ромашка");
  assert.equal(statement.rows[2].counterpartyInn, "123456789012");
  assert.equal(statement.declaredDebit, 55000.5);
  assert.equal(statement.declaredCredit, 250000);
  assert.deepEqual(statement.warnings, [], "контрольные суммы сошлись");
  assert.equal(statement.rows[0].id, "hash:4");
});

test("одна колонка «Сумма» без направления — знак не угадывается молча", () => {
  const grid = [
    ["Дата", "Сумма", "Назначение"],
    ["01.08.2027", "1000", "оплата"],
    ["02.08.2027", "2000", "поступление"],
  ];
  const statement = statementFromGrid(grid, "", "h");
  assert.equal(statement.rows.length, 2);
  assert.ok(statement.warnings.some((warning) => /знак операций не определён/.test(warning)));
  const withDirection = statementFromGrid([
    ["Дата", "Сумма", "Тип операции"],
    ["01.08.2027", "1000", "Списание"],
    ["02.08.2027", "2000", "Зачисление"],
  ], "", "h");
  assert.deepEqual(withDirection.rows.map((row) => row.amount), [-1000, 2000]);
  assert.deepEqual(withDirection.warnings, []);
});

test("владелец распознаётся и по «Наименование клиента:»", () => {
  const statement = statementFromGrid([["Дата", "Списание"], ["01.08.2027", "5"]], "Наименование клиента: ООО Вектор ИНН: 7701234567 Счет: 1", "h");
  assert.equal(statement.owner, "ООО Вектор");
  assert.equal(statement.ownerInn, "7701234567");
});
