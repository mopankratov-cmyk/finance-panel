import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { advertMonthStart, buildScopedAdvertReportRowsFromFacts } from "../lib/adverts/scopedReport";

test("WB adverts scoped report aggregates only allowlisted SKU", () => {
  const rows = buildScopedAdvertReportRowsFromFacts({
    allowedNmIds: [101, 202],
    products: [
      { nm_id: 101, article: "NOR-101" },
      { nm_id: 202, article: "RIO-202" },
    ],
    costs: [
      { article: "NOR-101", name: "Norvia", cost_rub: 100 },
      { article: "RIO-202", name: "Riobox", cost_rub: 250 },
      { article: "OTHER-999", name: "Other", cost_rub: 1 },
    ],
    stocks: [
      { nm_id: 101, quantity: 3 },
      { nm_id: 101, quantity: 2 },
      { nm_id: 202, quantity: 0 },
      { nm_id: 999, quantity: 99 },
    ],
    orders: [
      { nm_id: 101, supplier_article: "NOR-101", date: "2026-07-14T10:00:00.000Z", total_price: 1000, discount_percent: 10, is_cancel: false },
      { nm_id: 101, supplier_article: "NOR-101", date: "2026-07-14T11:00:00.000Z", total_price: 500, discount_percent: 0, is_cancel: true },
      { nm_id: 202, supplier_article: "RIO-202", date: "2026-07-14T12:00:00.000Z", total_price: 700, discount_percent: 0, is_cancel: false },
      { nm_id: 999, supplier_article: "OTHER-999", date: "2026-07-14T12:00:00.000Z", total_price: 9999, discount_percent: 0, is_cancel: false },
    ],
    funnelOrders: [
      { nm_id: 101, date: "2026-07-14", orders: 3, orders_sum: 2700 },
      { nm_id: 999, date: "2026-07-14", orders: 99, orders_sum: 9999 },
    ],
  });

  assert.deepEqual(rows, [
    {
      nm_id: 101,
      article: "NOR-101",
      orders_month: 3,
      orders_sum_month: 2700,
      stock: 5,
      in_way_to_client: 0,
      cost: 100,
    },
    {
      nm_id: 202,
      article: "RIO-202",
      orders_month: 1,
      orders_sum_month: 700,
      stock: 0,
      in_way_to_client: 0,
      cost: 250,
    },
  ]);
});

test("WB adverts month start uses the same 30-day window shape as rnp_report", () => {
  assert.equal(advertMonthStart(new Date("2026-07-15T12:00:00.000Z")), "2026-06-16");
});

test("WB adverts route does not let live WB balance hold the page for 45 seconds", () => {
  const source = readFileSync(new URL("../app/api/adverts/list/route.ts", import.meta.url), "utf8");
  assert.match(source, /signal:\s*AbortSignal\.timeout\(5_000\)/);
  assert.match(source, /loadScopedAdvertReportRows\(db,\s*cabinetId,\s*\[\.\.\.allowedNmIds\]\)/);
});

test("WB adverts scoped report reads funnel orders for the same allowlisted SKU set", () => {
  const source = readFileSync(new URL("../lib/adverts/scopedReport.ts", import.meta.url), "utf8");
  assert.match(source, /applyFunnelOrdersOverlay/);
  assert.match(source, /\.from\("wb_funnel_daily"\)/);
  assert.match(source, /\.select\("nm_id, date, orders, orders_sum"\)/);
  assert.match(source, /funnelOrders/);
});

test("WB adverts route keeps selected-cabinet loads off slow global fallbacks", () => {
  const source = readFileSync(new URL("../app/api/adverts/list/route.ts", import.meta.url), "utf8");
  assert.match(source, /changesQ = changesQ\.eq\("cabinet_id", cabinetId\)/);
  assert.match(source, /getWbCommissionForCabinet\(cabinetId,\s*30,\s*\{\s*allowLiveFallback:\s*false\s*\}\)/);
});

test("WB advert stats filters scoped campaigns before rotating fullstats batches", () => {
  const source = readFileSync(new URL("../app/api/sync/advert-stats/route.ts", import.meta.url), "utf8");
  const scopeFilterIndex = source.indexOf('aq = aq.overlaps("nm_ids", allowedNmIds)');
  const campaignQueryIndex = source.indexOf("const { data: advRows, error: advErr } = await aq");

  assert.notEqual(scopeFilterIndex, -1, "scoped cabinets must filter campaign nm_ids in Supabase");
  assert.notEqual(campaignQueryIndex, -1, "campaign query contract changed unexpectedly");
  assert.ok(scopeFilterIndex < campaignQueryIndex, "the SKU scope must be applied before campaigns are loaded and batched");
});

test("WB adverts page keeps the last-good list when a refresh times out", () => {
  const source = readFileSync(new URL("../components/wb/WbAdvertsPage.tsx", import.meta.url), "utf8");
  assert.match(source, /readApiResponse<AdvertsData>\(response, "Реклама WB"\)/);
  assert.match(source, /error && activeData/);
  assert.match(source, /Показан последний готовый список кампаний/);
  assert.doesNotMatch(source, /\(await response\.json\(\)\) as AdvertsData/);
});
