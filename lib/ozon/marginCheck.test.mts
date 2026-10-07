import assert from "node:assert/strict";
import test from "node:test";
import { buildOzonOpiuReport } from "./opiuOzonReport.ts";
import { buildOzonMarginBySku, totalOzonMargin, type OzonMarginAccrualRow } from "./marginBySku.ts";
import { buildOzonMarginCheck } from "./marginCheck.ts";

const rows: OzonMarginAccrualRow[] = [
  { accrual_id: "c:1", sku: "1", type_id: 69, accrued_category: "POSTING", amount: -100, quantity: 2, extra: { sale_amount: 1000 } },
  { accrual_id: "c:1", sku: "1", type_id: 1, accrued_category: "ITEM", amount: -10, quantity: null, extra: null },
  { accrual_id: "c:1", sku: "1", type_id: 29, accrued_category: "POSTING", amount: -50, quantity: null, extra: null },
  { accrual_id: "c:1", sku: "1", type_id: 32, accrued_category: "POSTING", amount: -30, quantity: null, extra: null },
];

function run(extra: OzonMarginAccrualRow[] = []) {
  const all = [...rows, ...extra];
  const totals = totalOzonMargin(buildOzonMarginBySku({ accrualRows: all, costBySku: new Map() }).rows);
  const report = buildOzonOpiuReport({ accrualRows: all, postings: [], typeNames: new Map() });
  return buildOzonMarginCheck(totals, report, all);
}

test("check is zero when every accrual lands on a SKU and a column", () => {
  const check = run();
  assert.equal(check.ok, true);
  assert.ok(check.cells.every((c) => c.diff === 0));
});

test("charges without a SKU show up as a difference", () => {
  const check = run([{ accrual_id: "c:2", sku: "-", type_id: 29, accrued_category: "POSTING", amount: -40, quantity: null, extra: null }]);
  assert.equal(check.ok, false);
  const lastMile = check.cells.find((c) => c.key === "lastMile")!;
  assert.equal(lastMile.diff, -40);
  assert.match(lastMile.explanation!, /1 начислен\. без артикула на 40,00 ₽/);
  assert.match(lastMile.explanation!, /Последняя миля/);
});

test("a gap with no SKU-less charges behind it is flagged as unexplained", () => {
  const totals = totalOzonMargin(buildOzonMarginBySku({ accrualRows: rows, costBySku: new Map() }).rows);
  const report = buildOzonOpiuReport({ accrualRows: [...rows, { ...rows[2], accrual_id: "c:9", sku: "1" }], postings: [], typeNames: new Map() });
  // отчёт видит лишнее начисление, которого нет в расчёте маржи, и без-SKU строк нет
  const check = buildOzonMarginCheck(totals, report, rows);
  const lastMile = check.cells.find((c) => c.key === "lastMile")!;
  assert.match(lastMile.explanation!, /причину установить не удалось/);
});

test("a new charge type is reported with its section and amount", () => {
  const check = run([{ accrual_id: "c:3", sku: "1", type_id: 9999, accrued_category: "POSTING", amount: -25, quantity: null, extra: null }]);
  assert.deepEqual(check.newCharges, [{ typeId: 9999, label: "Категория #9999", section: "logistics", amount: 25 }]);
});

test("no new charges when every type is in the layout", () => {
  assert.deepEqual(run().newCharges, []);
});
