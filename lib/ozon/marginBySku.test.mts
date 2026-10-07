import assert from "node:assert/strict";
import test from "node:test";
import { buildOzonMarginBySku, totalOzonMargin, type OzonMarginAccrualRow } from "./marginBySku.ts";

const COMMISSION = 69;

function row(overrides: Partial<OzonMarginAccrualRow>): OzonMarginAccrualRow {
  return {
    accrual_id: "c:1",
    sku: "1282975117",
    type_id: COMMISSION,
    accrued_category: "POSTING",
    amount: 0,
    quantity: 0,
    extra: null,
    ...overrides,
  };
}

// Кейс JG0902 из эталонной таблицы (01.09–16.09.2026): 4 продажи на 8 712 ₽,
// эквайринг 90,95, комиссия 4 530,24, последняя миля 53,04, логистика 395,
// себестоимость 1 248,80 (312,2 × 4), склад 62 (15,5 × 4) → ЧП без налога 2 331,97.
function jg0902Rows(): OzonMarginAccrualRow[] {
  return [
    row({ accrual_id: "c:1", amount: -4530.24, quantity: 4, extra: { sale_amount: 8712 } }),
    row({ accrual_id: "c:1", type_id: 1, accrued_category: "ITEM", amount: -90.95 }),
    row({ accrual_id: "c:1", type_id: 29, amount: -53.04 }),
    row({ accrual_id: "c:1", type_id: 32, amount: -395 }),
  ];
}

test("reproduces the JG0902 row of the reference sheet", () => {
  const { rows } = buildOzonMarginBySku({
    accrualRows: jg0902Rows(),
    costBySku: new Map([["1282975117", { article: "JG0902", cost: 312.2, warehouse: 15.5 }]]),
  });
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.article, "JG0902");
  assert.equal(r.salesQty, 4);
  assert.equal(r.salesRub, 8712);
  assert.equal(r.netQty, 4);
  assert.equal(r.netRub, 8712);
  assert.equal(r.acquiring, 90.95);
  assert.equal(r.commission, 4530.24);
  assert.equal(r.lastMile, 53.04);
  assert.equal(r.logistics, 395);
  assert.equal(r.logisticsTotal, 448.04);
  assert.equal(r.cost, 1248.8);
  assert.equal(r.warehouse, 62);
  assert.equal(r.profitBeforeTax, 2331.97);
  assert.equal(r.profitAfterTax, 2122.88);
  assert.equal(r.marginBeforeTaxPct, 26.77);
  assert.equal(r.marginAfterTaxPct, 24.37);
});

test("returns reduce sales, cancellations reduce only roubles", () => {
  const { rows } = buildOzonMarginBySku({
    accrualRows: [
      row({ accrual_id: "c:1", amount: -100, quantity: 2, extra: { sale_amount: 1000 } }),
      row({ accrual_id: "c:2", amount: 50, quantity: 1, extra: { sale_amount: -500 } }),
      // отмена начисления: у того же начисления вернулась услуга (сумма > 0)
      row({ accrual_id: "c:3", amount: 10, quantity: 1, extra: { sale_amount: -200 } }),
      row({ accrual_id: "c:3", type_id: 32, amount: 30 }),
    ],
    costBySku: new Map(),
  });
  const r = rows[0];
  assert.equal(r.salesQty, 2);
  assert.equal(r.returnsQty, 1);
  assert.equal(r.netQty, 1);
  assert.equal(r.returnsRub, -700);
  assert.equal(r.netRub, 300);
});

test("missing cost stays null, counts as zero in profit and is reported", () => {
  const result = buildOzonMarginBySku({
    accrualRows: jg0902Rows(),
    costBySku: new Map([["1282975117", { article: "JG0902", cost: 0, warehouse: 0 }]]),
  });
  assert.equal(result.rows[0].cost, null);
  assert.equal(result.rows[0].profitBeforeTax, 3642.77);
  assert.deepEqual(result.missingCost, ["JG0902"]);
});

test("unmapped SKU is shown by its id and reported as missing", () => {
  const result = buildOzonMarginBySku({ accrualRows: jg0902Rows(), costBySku: new Map() });
  assert.equal(result.rows[0].article, "1282975117");
  assert.deepEqual(result.missingCost, ["1282975117"]);
});

test("rows without a SKU and SKUs with no activity are skipped", () => {
  const result = buildOzonMarginBySku({
    accrualRows: [row({ sku: "-", type_id: 20, accrued_category: "NON_ITEM", amount: -5 }), row({ sku: "7" })],
    costBySku: new Map(),
  });
  assert.equal(result.rows.length, 0);
});

test("total margin is sum of profit over sum of revenue, not an average of percentages", () => {
  const { rows } = buildOzonMarginBySku({
    accrualRows: [
      ...jg0902Rows(),
      row({ sku: "5", accrual_id: "c:9", amount: -1, quantity: 1, extra: { sale_amount: 10 } }),
    ],
    costBySku: new Map(),
  });
  const total = totalOzonMargin(rows);
  assert.equal(total.netRub, 8722);
  assert.ok(Math.abs((total.marginBeforeTaxPct ?? 0) - (total.profitBeforeTax / 8722) * 100) < 0.01);
});

test("an unknown charge type goes to the new-types column and reduces profit", () => {
  const { rows } = buildOzonMarginBySku({
    accrualRows: [...jg0902Rows(), row({ type_id: 9999, amount: -100 })],
    costBySku: new Map([["1282975117", { article: "JG0902", cost: 312.2, warehouse: 15.5 }]]),
  });
  assert.equal(rows[0].newTypes, 100);
  assert.equal(rows[0].profitBeforeTax, 2231.97);
  assert.equal(rows[0].logisticsTotal, 448.04);
});

test("known non-margin types (ads, other deductions) stay out of the margin", () => {
  const { rows } = buildOzonMarginBySku({
    accrualRows: [...jg0902Rows(), row({ type_id: 41, amount: -100 })],
    costBySku: new Map([["1282975117", { article: "JG0902", cost: 312.2, warehouse: 15.5 }]]),
  });
  assert.equal(rows[0].newTypes, 0);
  assert.equal(rows[0].profitBeforeTax, 2331.97);
});
