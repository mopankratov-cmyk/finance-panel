import assert from "node:assert/strict";
import test from "node:test";

import { buildScopedBaseFactsFromRows, type ScopedOrderSourceRow } from "../lib/rnp/buildTable";

// Сплит ФБО/ФБС строится по сборочным заданиям Marketplace API: они существуют
// только у FBS-заказов, сопоставление по srid. warehouseType из статистики не
// используется — WB метит им и FBO-отгрузки из транзитных СЦ.

const order = (srid: string, date: string, price = 1000): ScopedOrderSourceRow => ({
  nm_id: 1,
  srid,
  supplier_article: "NV-01",
  date: `${date}T10:00:00`,
  total_price: price,
  discount_percent: 0,
  price_with_disc: price,
  is_cancel: false,
});

const NO_FACTS = { sales: [], advertSpend: [], stocks: [], products: [], costs: [] };

test("заказ со сборочным заданием — FBS, без него — FBW", () => {
  const { skuRows } = buildScopedBaseFactsFromRows({
    allowedNmIds: [1],
    orders: [order("srid-a", "2026-08-15", 500), order("srid-b", "2026-08-15", 700)],
    ...NO_FACTS,
    fbsFacts: { srids: new Set(["srid-a"]), cutoff: "2026-08-16" },
  });
  assert.equal(skuRows[0].orders_fbs_count, 1);
  assert.equal(skuRows[0].orders_fbs_sum, 500);
  assert.equal(skuRows[0].orders_fbw_count, 1);
  assert.equal(skuRows[0].orders_fbw_sum, 700);
});

test("день после границы покрытия синка не классифицируется", () => {
  const { skuRows } = buildScopedBaseFactsFromRows({
    allowedNmIds: [1],
    orders: [order("srid-a", "2026-08-15"), order("srid-c", "2026-08-17")],
    ...NO_FACTS,
    fbsFacts: { srids: new Set(["srid-a"]), cutoff: "2026-08-16" },
  });
  const byDate = new Map(skuRows.map((row) => [row.d, row]));
  // До границы — классифицировано (в том числе честный ноль FBW).
  assert.equal(byDate.get("2026-08-15")?.orders_fbs_count, 1);
  assert.equal(byDate.get("2026-08-15")?.orders_fbw_count, 0);
  // После границы «не-FBS» не доказан: свежее задание могло ещё не доехать.
  assert.equal(byDate.get("2026-08-17")?.orders_fbs_count, undefined);
  assert.equal(byDate.get("2026-08-17")?.orders_fbw_count, undefined);
});

test("без фактов Marketplace схема молчит целиком", () => {
  const { skuRows } = buildScopedBaseFactsFromRows({
    allowedNmIds: [1],
    orders: [order("srid-a", "2026-08-15")],
    ...NO_FACTS,
  });
  assert.equal(skuRows[0].orders_count, 1);
  assert.equal(skuRows[0].orders_fbs_count, undefined);
  assert.equal(skuRows[0].orders_fbw_count, undefined);
});

test("день в пределах покрытия без FBS-заказов — честный ноль, а не пропуск", () => {
  const { skuRows } = buildScopedBaseFactsFromRows({
    allowedNmIds: [1],
    orders: [order("srid-x", "2026-08-14")],
    ...NO_FACTS,
    fbsFacts: { srids: new Set<string>(), cutoff: "2026-08-16" },
  });
  assert.equal(skuRows[0].orders_fbs_count, 0);
  assert.equal(skuRows[0].orders_fbw_count, 1);
});
