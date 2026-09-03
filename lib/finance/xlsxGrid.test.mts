import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { firstSheetPath, unzipXlsx, xlsxGrid, xlsxText } from "./xlsxGrid.ts";

const statement = readFileSync(new URL("../../tests/fixtures/bank-statement-mini.xlsx", import.meta.url));

test("первый лист берётся по workbook.xml, а не по имени sheet1.xml", () => {
  const entries = unzipXlsx(statement);
  assert.equal(firstSheetPath(entries), "xl/worksheets/sheet2.xml");
  const grid = xlsxGrid(statement);
  assert.notEqual(grid[0]?.[0], "ЛОЖНЫЙ ЛИСТ");
  assert.equal(grid[0]?.[0], "Клиент: ИП Иванов Иван Иванович");
});

test("общие строки, inline-строки и числа читаются в одну сетку", () => {
  const grid = xlsxGrid(statement);
  assert.deepEqual(grid[2].slice(0, 3), ["Дата операции", "Списание", "Зачисление"]);
  assert.equal(grid[3][0], "46600", "серийная дата — числом");
  assert.equal(grid[4][0], "02.08.2027", "inlineStr");
  assert.equal(grid[3][1], "15000.5");
  assert.equal(grid[4][2], "250000");
});

test("текст книги содержит шапку для регулярок владельца и ИНН", () => {
  const text = xlsxText(statement);
  assert.match(text, /Клиент: ИП Иванов Иван Иванович/);
  assert.match(text, /ИНН: 123456789012/);
});
