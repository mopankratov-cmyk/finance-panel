import assert from "node:assert/strict";
import test from "node:test";
import { buildScopedBaseFactsFromAggregate, buildScopedBaseFactsFromRows } from "./buildTable.ts";

// Оптима: 10 679 заказов на 18 артикулах за неделю. Прежний путь тянул их
// построчно, новый берёт агрегат из базы — арифметика обязана совпасть,
// иначе поедут деньги в отчётах.
const stocks = [{ nm_id: 7, quantity: 5, in_way_to_client: 1, in_way_from_client: 0 }];
const products = [{ nm_id: 7, article: "PEN-1" }];
const costs = [{ article: "PEN-1", name: "Пенал", cost_rub: 100 }];

test("агрегат даёт те же цифры, что построчный разбор", () => {
  const fromRows = buildScopedBaseFactsFromRows({
    allowedNmIds: [7],
    orders: [
      { nm_id: 7, srid: "s1", supplier_article: "PEN-1", date: "2026-08-20T10:00:00Z", total_price: 500, discount_percent: 20, price_with_disc: 400, is_cancel: false },
      { nm_id: 7, srid: "s2", supplier_article: "PEN-1", date: "2026-08-20T12:00:00Z", total_price: 500, discount_percent: 20, price_with_disc: 400, is_cancel: true },
    ],
    sales: [{ nm_id: 7, date: "2026-08-20T13:00:00Z", price_with_disc: 380, finished_price: 350, sale_id: "S123" }],
    advertSpend: [{ nm_id: 7, date: "2026-08-20", spent: 90 }],
    stocks, products, costs,
    fbsFacts: { srids: new Set(["s1"]), cutoff: "2026-08-21" },
  });

  const fromAggregate = buildScopedBaseFactsFromAggregate({
    allowedNmIds: [7],
    aggregate: [{
      d: "2026-08-20", nm_id: 7, article: "PEN-1",
      orders_count: 1, orders_sum: 400, orders_gross_sum: 500,
      cancels_count: 1, cancels_sum: 400,
      orders_fbs_count: 1, orders_fbs_sum: 400, orders_fbw_count: 0, orders_fbw_sum: 0,
      buyouts_count: 1, buyouts_sum: 380, buyouts_gross_sum: 380, buyouts_finished_sum: 350,
      ad_spent: 90,
    }],
    stocks, products, costs,
    fbsCutoff: "2026-08-21",
  });

  assert.deepEqual(fromAggregate.skuRows, fromRows.skuRows);
  assert.deepEqual(fromAggregate.totals, fromRows.totals);
});

test("за границей достоверности схема молчит, а не показывает нули", () => {
  // День позже границы: раскладка по FBS/FBW не доказана, полей быть не должно.
  const rows = buildScopedBaseFactsFromAggregate({
    allowedNmIds: [7],
    aggregate: [{
      d: "2026-08-22", nm_id: 7, article: "PEN-1",
      orders_count: 2, orders_sum: 800, orders_gross_sum: 1000,
      cancels_count: 0, cancels_sum: 0,
      orders_fbs_count: 0, orders_fbs_sum: 0, orders_fbw_count: 0, orders_fbw_sum: 0,
      buyouts_count: 0, buyouts_sum: 0, buyouts_gross_sum: 0, buyouts_finished_sum: 0,
      ad_spent: 0,
    }],
    stocks, products, costs,
    fbsCutoff: "2026-08-21",
  });

  assert.equal("orders_fbs_count" in rows.skuRows[0], false);
  assert.equal(rows.skuRows[0].orders_count, 2);
  // Отмены известны всегда: их считает сама функция, а не догадка.
  assert.equal(rows.skuRows[0].cancels_count, 0);
});

test("числовые строки из Postgres не превращаются в конкатенацию", () => {
  const rows = buildScopedBaseFactsFromAggregate({
    allowedNmIds: [7],
    aggregate: [{
      d: "2026-08-20", nm_id: 7, article: "PEN-1",
      orders_count: 2, orders_sum: "400.50", orders_gross_sum: "500.25",
      cancels_count: 0, cancels_sum: "0",
      orders_fbs_count: 0, orders_fbs_sum: "0", orders_fbw_count: 0, orders_fbw_sum: "0",
      buyouts_count: 1, buyouts_sum: "380.10", buyouts_gross_sum: "380.10", buyouts_finished_sum: "350.05",
      ad_spent: "90.90",
    }],
    stocks, products, costs,
  });

  assert.equal(rows.skuRows[0].orders_sum, 400.5);
  assert.equal(rows.skuRows[0].ad_spent, 90.9);
});
