import assert from "node:assert/strict";
import test from "node:test";
import { flattenOzonAccrual, OZON_ACCRUAL_NO_SKU, OZON_ACCRUAL_SALE_COMMISSION_TYPE_ID } from "./accrualRows.ts";

test("ITEM accrual (no posting) becomes one row keyed by its single fee type_id", () => {
  const raw = {
    accrual_id: 59770995112,
    date: "2026-08-15",
    total_amount: { amount: "-4.13", currency: "RUB" },
    unit_number: "17300007-0240",
    accrued_category: "ITEM",
    posting: null,
    item_fees: { fees: [{ sku: 4822584943, fees: [{ type_id: 1, accrued: { amount: "-4.13", currency: "RUB" } }], quantity: 1 }] },
    non_item_fee: null,
    container_fees: null,
  };
  const rows = flattenOzonAccrual(raw);
  assert.deepEqual(rows, [{
    accrual_id: 59770995112,
    date: "2026-08-15",
    unit_number: "17300007-0240",
    accrued_category: "ITEM",
    currency: "RUB",
    sku: "4822584943",
    type_id: 1,
    amount: -4.13,
    quantity: 1,
    extra: null,
  }]);
});

test("NON_ITEM accrual has no sku and gets the sentinel", () => {
  const raw = {
    accrual_id: 59805156718,
    date: "2026-08-15",
    total_amount: { amount: "-547.8", currency: "RUB" },
    unit_number: "2000062782226",
    accrued_category: "NON_ITEM",
    posting: null,
    item_fees: null,
    non_item_fee: { type_id: 12, accrued: { amount: "-547.8", currency: "RUB" } },
    container_fees: null,
  };
  const rows = flattenOzonAccrual(raw);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sku, OZON_ACCRUAL_NO_SKU);
  assert.equal(rows[0].type_id, 12);
  assert.equal(rows[0].amount, -547.8);
});

test("POSTING accrual with delivery services only (no sale) produces one row per service", () => {
  const raw = {
    accrual_id: 59771331611,
    date: "2026-08-15",
    total_amount: { amount: "-17.28", currency: "RUB" },
    unit_number: "0182305566-0017-1",
    accrued_category: "POSTING",
    posting: {
      delivery_schema: "Fbo",
      products: [{
        sku: 4942088018,
        quantity: 1,
        delivery: { total_accrued: { amount: "-17.28", currency: "RUB" }, services: [{ type_id: 32, accrued: { amount: "-17.28", currency: "RUB" } }] },
        commission: null,
      }],
    },
    item_fees: null,
    non_item_fee: null,
    container_fees: null,
  };
  const rows = flattenOzonAccrual(raw);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sku, "4942088018");
  assert.equal(rows[0].type_id, 32);
  assert.equal(rows[0].amount, -17.28);
});

test("POSTING accrual with an actual sale produces service rows plus one synthetic commission row", () => {
  const raw = {
    accrual_id: 59787844001,
    date: "2026-08-15",
    total_amount: { amount: "702.86", currency: "RUB" },
    unit_number: "95159405-0066-1",
    accrued_category: "POSTING",
    posting: {
      delivery_schema: "Fbo",
      products: [{
        sku: 4004598018,
        quantity: 1,
        delivery: {
          total_accrued: { amount: "-64.14", currency: "RUB" },
          services: [
            { type_id: 32, accrued: { amount: "-56", currency: "RUB" } },
            { type_id: 29, accrued: { amount: "-8.14", currency: "RUB" } },
          ],
        },
        commission: {
          seller_price: { amount: "1300", currency: "RUB" },
          sale_price: { amount: "593.33", currency: "RUB" },
          sale_commission: { amount: "-533", currency: "RUB" },
          commission: { amount: "-533", currency: "RUB" },
          commission_ratio: 'value:"0.410000"',
          sale_amount: { amount: "1300", currency: "RUB" },
          coinvestment: { amount: "5.93", currency: "RUB" },
          bonus: { amount: "700.74", currency: "RUB" },
        },
      }],
    },
    item_fees: null,
    non_item_fee: null,
    container_fees: null,
  };
  const rows = flattenOzonAccrual(raw);
  assert.equal(rows.length, 3);
  const commissionRow = rows.find((row) => row.type_id === OZON_ACCRUAL_SALE_COMMISSION_TYPE_ID);
  assert.ok(commissionRow, "expected a synthetic SaleCommission row");
  assert.equal(commissionRow!.amount, -533);
  assert.equal(commissionRow!.sku, "4004598018");
  assert.deepEqual(commissionRow!.extra, {
    seller_price: 1300,
    sale_price: 593.33,
    sale_amount: 1300,
    coinvestment: 5.93,
    bonus: 700.74,
    commission_ratio: 'value:"0.410000"',
  });
});

test("a row with no amount field defaults to 0 instead of throwing", () => {
  const raw = {
    accrual_id: 1,
    date: "2026-08-15",
    total_amount: { amount: "0", currency: "RUB" },
    unit_number: null,
    accrued_category: "NON_ITEM",
    posting: null,
    item_fees: null,
    non_item_fee: { type_id: 5, accrued: undefined },
    container_fees: null,
  };
  const rows = flattenOzonAccrual(raw);
  assert.equal(rows[0].amount, 0);
});
