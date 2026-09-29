import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { ozonBalanceStockCounts, ozonBalanceStockQuantity } from "../lib/ozon/api";

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

test("месячный снимок использует новый отчёт остатков и opening balance Ozon", () => {
  const route = readFileSync(new URL("../app/api/sync/balance-monthly-stock/route.ts", import.meta.url), "utf8");
  assert.match(route, /ozonBalanceStocks/);
  assert.match(route, /amount: balance\.balance\.opening/);
  assert.doesNotMatch(route, /amount: balance\.balance\.closing/);
});
