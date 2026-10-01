import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { collectOzonBalanceSkus, mergeOzonBalanceStockItems, ozonBalanceStockCounts, ozonBalanceStockQuantity } from "../lib/ozon/api";

test("баланс Ozon не теряет SKU, которые есть только в product/list или FBO", () => {
  assert.deepEqual(collectOzonBalanceSkus(
    [{ product_id: 1, sku: 101 }, { product_id: 2 }],
    [{ sku: 102, sources: [{ sku: 103 }, { sku: 101 }] }],
    [{ sku: 104, offer_id: "OZ-104", warehouse_id: 10, present: 1, reserved: 0 }],
  ), ["101", "102", "103", "104"]);
});

test("баланс Ozon складывает все количественные столбцы отчёта", () => {
  const item = {
    total_stock_count: 592,
    available_stock_count: 336,
    valid_stock_count: 5,
    waiting_docs_to_export_stock_count: 0,
    waiting_docs_stock_count: 0,
    expiring_stock_count: 0,
    transit_defect_stock_count: 0,
    stock_defect_stock_count: 0,
    excess_stock_count: 0,
    other_stock_count: 5,
    requested_stock_count: 0,
    transit_stock_count: 0,
    delivering_to_customer_stock_count: 86,
    return_from_customer_stock_count: 56,
    moving_stock_count: 0,
    return_to_seller_stock_count: 2,
    ready_to_export_stock_count: 0,
    returning_to_seller_stock_count: 0,
    ads: 3.74,
    days_without_sales: 1,
  };

  assert.equal(ozonBalanceStockQuantity(item), 1082);
  assert.deepEqual(ozonBalanceStockCounts(item), {
    total_stock_count: 592,
    available_stock_count: 336,
    valid_stock_count: 5,
    other_stock_count: 5,
    delivering_to_customer_stock_count: 86,
    return_from_customer_stock_count: 56,
    return_to_seller_stock_count: 2,
  });
});

test("новый статус Ozon автоматически попадает в баланс", () => {
  assert.equal(ozonBalanceStockQuantity({ available_stock_count: 10, future_stock_count: "3" }), 13);
});

test("остатки Ozon дополняются общим количеством и доставкой из FBO-метода", () => {
  const rows = mergeOzonBalanceStockItems([
    {
      sku: 1871577470,
      offer_id: "CLR00912",
      warehouse_id: 10,
      warehouse_name: "НОГИНСК_РФЦ",
      available_stock_count: 330,
      valid_stock_count: 7,
      other_stock_count: 5,
      return_from_customer_stock_count: 57,
      return_to_seller_stock_count: 2,
    },
  ], [
    {
      sku: 1871577470,
      offer_id: "CLR00912",
      warehouse_id: 10,
      present: 589,
      reserved: 84,
    },
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.quantity, 1074);
  assert.deepEqual(rows[0]?.statusCounts, {
    available_stock_count: 330,
    valid_stock_count: 7,
    other_stock_count: 5,
    return_from_customer_stock_count: 57,
    return_to_seller_stock_count: 2,
    total_stock_count: 589,
    delivering_to_customer_stock_count: 84,
  });
});

test("FBO-метод не дублирует столбцы, если Ozon вернёт их в аналитике", () => {
  const rows = mergeOzonBalanceStockItems([
    {
      sku: 1,
      warehouse_id: 10,
      total_stock_count: 12,
      delivering_to_customer_stock_count: 3,
    },
  ], [{ sku: 1, warehouse_id: 10, present: 12, reserved: 3 }]);

  assert.equal(rows[0]?.quantity, 15);
});

test("месячный снимок использует новый отчёт остатков и opening balance Ozon", () => {
  const route = readFileSync(new URL("../app/api/sync/balance-monthly-stock/route.ts", import.meta.url), "utf8");
  const api = readFileSync(new URL("../lib/ozon/api.ts", import.meta.url), "utf8");
  assert.match(route, /ozonBalanceStocks/);
  assert.match(route, /amount: balance\.balance\.opening/);
  assert.doesNotMatch(route, /amount: balance\.balance\.closing/);
  assert.match(api, /JSON\.stringify\(\{ skus, limit: 1000, cursor: fboCursor \}\)/);
  assert.match(api, /catalogSkus\.slice\(index, index \+ 100\)/);
  assert.match(api, /collectOzonBalanceSkus\(productListItems, productInfoItems, fboStocks\)/);
});
