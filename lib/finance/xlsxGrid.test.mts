import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { firstSheetPath, unzipXlsx, xlsxGrid, xlsxGridFromEntries, xlsxText } from "./xlsxGrid.ts";

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

test("XLSX с namespace-префиксом x: читается так же, как обычный", () => {
  const entries = new Map<string, Buffer>([
    ["xl/worksheets/sheet1.xml", Buffer.from('<?xml version="1.0"?><x:worksheet xmlns:x="urn:test"><x:sheetData><x:row r="1"><x:c r="A1" t="s"><x:v>0</x:v></x:c><x:c r="B1"><x:v>42</x:v></x:c></x:row></x:sheetData></x:worksheet>')],
    ["xl/sharedStrings.xml", Buffer.from('<x:sst xmlns:x="urn:test"><x:si><x:t>Платёж</x:t></x:si></x:sst>')],
  ]);
  assert.deepEqual(xlsxGridFromEntries(entries), [["Платёж", "42"]]);
});
