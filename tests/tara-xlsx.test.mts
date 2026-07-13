import test from "node:test";
import assert from "node:assert/strict";
import { buildXlsx } from "../lib/xlsx/write";
import { readXlsxRows } from "../lib/xlsx/read";
import { parseTaraRows } from "../lib/supplies/tara";

test("containerscontent XLSX is read and flexible Russian headers are detected", () => {
  const file = buildXlsx("containerscontent", [
    ["Выгрузка готовой тары"],
    ["Номер короба", "Артикул продавца", "nmId", "ШК", "Кол-во", "Объём, л"],
    ["BOX-001", "NORVIA-01", 123, "0460000000001", 12, "8,5"],
    ["BOX-002", "RIOBOX-02", 456, "0460000000002", 7, 4],
  ]);
  const parsed = parseTaraRows(readXlsxRows(file));
  assert.equal(parsed.headerRow, 2);
  assert.deepEqual(parsed.summary, { containers: 2, skuRows: 2, quantity: 19, volumeLiters: 12.5 });
  assert.equal(parsed.lines[0].barcode, "0460000000001");
  assert.equal(parsed.errors.length, 0);
});

test("tara parser reports broken rows instead of silently importing them", () => {
  const parsed = parseTaraRows([["Тара", "Артикул", "Количество"], ["A", "SKU-1", "0"], ["", "SKU-2", "2"]]);
  assert.equal(parsed.lines.length, 0);
  assert.equal(parsed.errors.length, 2);
  assert.match(parsed.errors[0], /количество/);
});

test("duplicate rows in the same box are deterministically merged", () => {
  const parsed = parseTaraRows([["box", "sku", "qty"], ["A", "SKU-1", "2"], ["A", "SKU-1", "3"]]);
  assert.equal(parsed.lines.length, 1);
  assert.equal(parsed.lines[0].quantity, 5);
  assert.equal(parsed.warnings.length, 1);
});
