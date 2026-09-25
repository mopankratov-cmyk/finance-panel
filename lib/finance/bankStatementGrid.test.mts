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
  assert.equal(statement.rows[0].documentNumber, "", "номер строки нельзя выдавать за номер банковского документа");
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

test("Ozon определяется по шапке, а счёт владельца и реквизиты — в двухстрочной форме банка", () => {
  const grid = [
    ["", "ООО \"ОЗОН БАНК\""],
    ["", "Клиент:", "", "", "", "ИП Панкратов Максим Олегович"],
    ["", "ИНН:", "", "", "", "280888215133"],
    ["", "Счет:", "", "", "", "40802810100000112301"],
    ["", "Входящий остаток:", "", "", "", "0"],
    ["", "Исходящий остаток:", "", "", "", "25625.88"],
    ["", "Дата", "Номер документа", "Дебет", "Кредит", "Контрагент", "", "", "Назначение платежа"],
    ["", "", "", "", "", "Наименование, ИНН", "Cчёт, БИК банка"],
    ["", "11.09.2026", "80", "21000", "", "ООО \"ПИОНЕР ПРО\"\nИНН:7709976927", "Р/С:40702810901500001720\nБИК:044525104", "", "По счету №3266. Банк Точка указан только в операции"],
  ];
  const metadata = grid.flat().join(" ");
  const statement = statementFromGrid(grid, metadata, "ozon-hash");
  assert.equal(statement.bank, "Ozon Банк");
  assert.equal(statement.accountNumber, "40802810100000112301");
  assert.equal(statement.closingBalance, 25625.88);
  assert.equal(statement.rows[0].counterpartyInn, "7709976927");
  assert.equal(statement.rows[0].counterpartyAccount, "40702810901500001720");
});

test("ВБ Банк: многострочная шапка, владелец, счёт и направления операций", () => {
  const grid = [
    ["ОО \"ВБ Банк\""],
    ["Выписка операций по счету", "40802810900000016002"],
    ["За период", "с 01.09.2026 по 24.09.2026"],
    ["ИНН КИО", "330573647518"],
    ["Индивидуальный предприниматель ФИЛИППОВ АРТЕМ СЕРГЕЕВИЧ"],
    ["Входящий остаток", "0"],
    ["Исходящий остаток", "0,13"],
    ["Обороты по дебету", "4555005,88"],
    ["Обороты по кредиту", "4555006,01"],
    ["Дата", "Документ", "", "Контрагент", "", "Сумма", "", "Назначение платежа"],
    ["", "Тип документа", "Номер", "Наименование", "ИНН", "По дебету", "По кредиту", ""],
    ["22.09.2026", "Платёжное поручение", "101", "ИП Филиппов", "330573647518", "2524206", "", "Перевод собственных средств"],
    ["22.09.2026", "Платёжное поручение", "102", "ООО РВБ", "9705123155", "", "2229006,01", "Оплата за товар"],
    ["23.09.2026", "Банковский ордер", "103", "ОО ВБ Банк", "0102000578", "3799,88", "", "Комиссия Банка"],
    ["24.09.2026", "Платёжное поручение", "104", "ООО РВБ", "9705123155", "", "2326000", "Оплата за товар"],
    ["24.09.2026", "Платёжное поручение", "105", "ИП Филиппов", "330573647518", "2027000", "", "Перевод собственных средств"],
  ];
  const statement = statementFromGrid(grid, grid.flat().join(" "), "vb-hash");
  assert.equal(statement.bank, "ВБ Банк");
  assert.equal(statement.owner, "Индивидуальный предприниматель ФИЛИППОВ АРТЕМ СЕРГЕЕВИЧ");
  assert.equal(statement.ownerInn, "330573647518");
  assert.equal(statement.accountNumber, "40802810900000016002");
  assert.deepEqual(statement.rows.map((row) => row.amount), [-2524206, 2229006.01, -3799.88, 2326000, -2027000]);
  assert.deepEqual(statement.rows.map((row) => row.documentNumber), ["101", "102", "103", "104", "105"]);
  assert.equal(statement.declaredDebit, 4555005.88);
  assert.equal(statement.declaredCredit, 4555006.01);
  assert.deepEqual(statement.warnings, []);
});
