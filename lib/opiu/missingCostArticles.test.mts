import assert from "node:assert/strict";
import test from "node:test";
import { buildCostLookup, findMissingCostArticles, type ProductCostRow } from "./metrics";
import type { WbReportRow } from "@/lib/wb/types";

function saleRow(overrides: Partial<WbReportRow>): WbReportRow {
  return {
    rr_dt: "2026-08-24",
    doc_type_name: "Продажа",
    supplier_oper_name: "Продажа",
    quantity: 1,
    retail_amount: 1000,
    retail_price_withdisc_rub: 1000,
    sa_name: "TEST-001",
    barcode: "1234567890123",
    ...overrides,
  } as WbReportRow;
}

function returnRow(overrides: Partial<WbReportRow>): WbReportRow {
  return {
    rr_dt: "2026-08-25",
    doc_type_name: "Возврат",
    supplier_oper_name: "Возврат",
    quantity: 1,
    retail_amount: 1000,
    retail_price_withdisc_rub: 1000,
    sa_name: "TEST-001",
    barcode: "1234567890123",
    ...overrides,
  } as WbReportRow;
}

const knownCost: ProductCostRow = {
  article: "KNOWN-001",
  wb_barcode: "9999999999999",
  cost_rub: 500,
  warehouse_expenses: 50,
};

test("findMissingCostArticles: товар без карточки в /costs попадает в список", () => {
  const lookup = buildCostLookup([knownCost]);
  const rows = [saleRow({ sa_name: "MISSING-001", barcode: "1111111111111" })];
  const missing = findMissingCostArticles(rows, lookup);
  assert.equal(missing.length, 1);
  assert.equal(missing[0]!.article, "MISSING-001");
  assert.equal(missing[0]!.qty, 1);
});

test("findMissingCostArticles: товар С карточкой в /costs не попадает в список", () => {
  const lookup = buildCostLookup([knownCost]);
  const rows = [saleRow({ sa_name: "KNOWN-001", barcode: "9999999999999" })];
  const missing = findMissingCostArticles(rows, lookup);
  assert.equal(missing.length, 0);
});

test("findMissingCostArticles: находка по баркоду (без совпадения по артикулу) тоже засчитывается", () => {
  const lookup = buildCostLookup([knownCost]);
  // Артикул другой, но баркод совпадает с тем, что есть в /costs — не должен считаться пропавшим.
  const rows = [saleRow({ sa_name: "DIFFERENT-NAME", barcode: "9999999999999" })];
  const missing = findMissingCostArticles(rows, lookup);
  assert.equal(missing.length, 0);
});

test("findMissingCostArticles: продажи и возвраты по одному пропавшему артикулу нетто-суммируются", () => {
  const lookup = buildCostLookup([knownCost]);
  const rows = [
    saleRow({ sa_name: "MISSING-002", barcode: "2222222222222", quantity: 3 }),
    returnRow({ sa_name: "MISSING-002", barcode: "2222222222222", quantity: 1 }),
  ];
  const missing = findMissingCostArticles(rows, lookup);
  assert.equal(missing.length, 1);
  assert.equal(missing[0]!.qty, 2); // 3 продажи - 1 возврат
});

test("findMissingCostArticles: полностью компенсированный возвратом артикул (qty=0) не засоряет список", () => {
  const lookup = buildCostLookup([knownCost]);
  const rows = [
    saleRow({ sa_name: "MISSING-003", barcode: "3333333333333", quantity: 1 }),
    returnRow({ sa_name: "MISSING-003", barcode: "3333333333333", quantity: 1 }),
  ];
  const missing = findMissingCostArticles(rows, lookup);
  assert.equal(missing.length, 0);
});

test("findMissingCostArticles: строки не sale/return ('other') игнорируются", () => {
  const lookup = buildCostLookup([knownCost]);
  const rows = [
    saleRow({
      sa_name: "MISSING-004",
      barcode: "4444444444444",
      doc_type_name: undefined,
      supplier_oper_name: "Логистика",
    }),
  ];
  const missing = findMissingCostArticles(rows, lookup);
  assert.equal(missing.length, 0);
});
