import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { mergeScopedUnitPeriodRows } from "../lib/unit/scopedPeriodReport";

test("scoped unit fallback preserves every allowed SKU and aggregates the selected calendar period", () => {
  const rows = mergeScopedUnitPeriodRows(
    new Set([101, 102]),
    [
      { d: "2026-07-27", nm_id: 101, orders_count: 3, orders_sum: 900, buyouts_count: 1, ad_spent: 90 },
      { d: "2026-07-28", nm_id: 101, orders_count: 2, orders_sum: 650, buyouts_count: 2, ad_spent: 65 },
    ],
    [
      { nm_id: 101, article: "HT-80-11", stock: 12, in_way_to_client: 3, cost: 1_100 },
    ],
    [
      { nm_id: 101, article: "HT-80-11", cost: 1_100 },
      { nm_id: 102, article: "ESC00121", cost: 35 },
    ],
  );

  assert.deepEqual(rows, [
    {
      nm_id: 101,
      article: "HT-80-11",
      orders_month: 5,
      orders_sum_month: 1_550,
      buyouts_month: 3,
      stock: 12,
      in_way_to_client: 3,
      cost: 1_100,
      ad_spend_month: 155,
    },
    {
      nm_id: 102,
      article: "ESC00121",
      orders_month: 0,
      orders_sum_month: 0,
      buyouts_month: 0,
      stock: 0,
      in_way_to_client: 0,
      cost: 35,
      ad_spend_month: 0,
    },
  ]);
});

test("unit table falls back to paged RNP sources only for a non-empty restricted scope", async () => {
  const source = await readFile(new URL("../app/api/unit/table/route.ts", import.meta.url), "utf8");

  assert.match(source, /p_cabinet && allowedNmIds !== null && allowedNmIds\.size > 0 && scopedRows\.length === 0/);
  assert.match(source, /loadRnpDailySkuRows<ScopedUnitDailyRow>/);
  assert.match(source, /loadRnpReportRows<ScopedUnitReferenceRow>/);
  assert.match(source, /mergeScopedUnitPeriodRows\(allowedNmIds/);
});

test("unit page clears stale cabinet totals before loading the next cabinet", async () => {
  const source = await readFile(new URL("../components/wb/WbUnitPage.tsx", import.meta.url), "utf8");
  const requestStart = source.slice(source.indexOf("setLoading(true);"), source.indexOf("const refreshParam"));

  assert.match(requestStart, /setError\(null\);\s+setData\(null\);/);
});
