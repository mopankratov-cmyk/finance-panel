import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { earliestKnownDate, latestDate, latestKnownDate, loadAllPages } from "../lib/rnp/buildTable";
import {
  currentMoscowMonth,
  WB_RNP_BACKGROUND_REFRESH,
  WB_RNP_CACHE_SECONDS,
  WB_RNP_CACHE_VERSION,
  wbRnpCacheIdentity,
  wbRnpCacheTag,
  wbRnpRevalidationProfile,
} from "../lib/rnp/tableCache";

test("WB RNP snapshot isolates cabinets and periods", () => {
  const all = wbRnpCacheIdentity({ from: "2026-07-01", to: "2026-07-31", cabinetId: null });
  const cabinet = wbRnpCacheIdentity({ from: "2026-07-01", to: "2026-07-31", cabinetId: "cab-a", label: "Optima" });
  const nextMonth = wbRnpCacheIdentity({ from: "2026-08-01", to: "2026-08-31", cabinetId: null });
  assert.notEqual(all, cabinet);
  assert.notEqual(all, nextMonth);
});

test("WB RNP snapshot tag is compact", () => {
  const tag = wbRnpCacheTag({ from: "2026-07-01", to: "2026-07-31", cabinetId: "cab-a", label: "Optima" });
  assert.match(tag, /^wb-rnp:[a-f0-9]{32}$/);
  assert.ok(tag.length < 256);
  assert.equal(tag.includes("Optima"), false);
});

test("WB RNP data-integrity schema invalidates the previous snapshot", () => {
  assert.equal(WB_RNP_CACHE_VERSION, "v8");
});

test("WB RNP last-good snapshot survives short cron gaps", () => {
  assert.equal(WB_RNP_CACHE_SECONDS, 12 * 60 * 60);
});

test("WB RNP interactive loader does not start slow live WB commission reports", async () => {
  const source = await readFile(new URL("../lib/rnp/buildTable.ts", import.meta.url), "utf8");
  assert.match(source, /getWbCommissionForCabinet\(p_cabinet,\s*30,\s*\{\s*allowLiveFallback:\s*false\s*\}\)/);
});

test("WB dashboard facts have selected-cabinet query indexes", async () => {
  const migration = await readFile(new URL("../supabase/migrations/20260715_wb_dashboard_query_indexes.sql", import.meta.url), "utf8");
  for (const indexName of [
    "wb_orders_cabinet_date_nm_idx",
    "wb_sales_cabinet_date_nm_idx",
    "wb_advert_nm_daily_cabinet_date_nm_idx",
    "wb_funnel_daily_cabinet_date_nm_idx",
    "wb_stocks_cabinet_nm_idx",
    "wb_advert_stats_cabinet_date_advert_idx",
    "wb_adverts_cabinet_status_advert_idx",
    "product_costs_article_idx",
  ]) {
    assert.match(migration, new RegExp(`create index if not exists ${indexName}`));
  }
});

test("WB RNP hourly warmup uses the Moscow calendar month", () => {
  assert.deepEqual(currentMoscowMonth(new Date("2026-07-31T21:30:00.000Z")), {
    from: "2026-08-01",
    to: "2026-08-31",
  });
});

test("WB RNP hourly warmup keeps the previous snapshot while refreshing", () => {
  assert.deepEqual(WB_RNP_BACKGROUND_REFRESH, { backgroundRefresh: true });
  assert.equal(wbRnpRevalidationProfile(WB_RNP_BACKGROUND_REFRESH), "max");
  assert.deepEqual(wbRnpRevalidationProfile({ forceRefresh: true }), { expire: 0 });
  assert.equal(wbRnpRevalidationProfile({}), null);
});

test("marketplace cron waits for fresh WB and Ozon snapshots before returning", async () => {
  const source = await readFile(new URL("../app/api/sync/dashboard-cache/route.ts", import.meta.url), "utf8");
  assert.match(source, /const BLOCKING_SNAPSHOT_REFRESH = \{ forceRefresh: true \} as const/);
  assert.doesNotMatch(source, /WB_RNP_BACKGROUND_REFRESH|OZON_COCKPIT_BACKGROUND_REFRESH/);
  assert.match(source, /loadCachedWbRnp\([\s\S]+?BLOCKING_SNAPSHOT_REFRESH\)/);
  assert.match(source, /loadCachedOzonCockpit\([\s\S]+?BLOCKING_SNAPSHOT_REFRESH\)/);
});

test("RNP loader drains every PostgREST page instead of stopping at 1,000 rows", async () => {
  const source = Array.from({ length: 2_305 }, (_, index) => ({ id: index + 1 }));
  const requested: Array<[number, number]> = [];

  const rows = await loadAllPages(async (from, to) => {
    requested.push([from, to]);
    return { data: source.slice(from, to + 1), error: null };
  });

  assert.equal(rows.length, 2_305);
  assert.deepEqual(rows.at(-1), { id: 2_305 });
  assert.deepEqual(requested, [[0, 999], [1_000, 1_999], [2_000, 2_999]]);
});

test("RNP loader surfaces database errors and guards against an endless full page", async () => {
  await assert.rejects(
    loadAllPages(async () => ({ data: null, error: { message: "PostgREST failed" } })),
    /PostgREST failed/,
  );
  await assert.rejects(
    loadAllPages(async () => ({ data: [{ id: 1 }], error: null }), { pageSize: 1, maxPages: 2 }),
    /безопасный лимит 2 строк/,
  );
});

test("RNP loader retries a transient database timeout without duplicating rows", async () => {
  let attempts = 0;
  const rows = await loadAllPages(async () => {
    attempts++;
    return attempts === 1
      ? { data: null, error: { message: "canceling statement due to statement timeout" } }
      : { data: [{ id: 7 }], error: null };
  });
  assert.equal(attempts, 2);
  assert.deepEqual(rows, [{ id: 7 }]);
});

test("RNP freshness helpers choose real source dates", () => {
  assert.equal(latestDate([{ date: "2026-07-12" }, { date: "2026-07-14T09:00:00Z" }], (row) => row.date), "2026-07-14");
  assert.equal(latestKnownDate(["2026-07-12", null, "2026-07-14"]), "2026-07-14");
  assert.equal(earliestKnownDate(["2026-07-14", null, "2026-07-13"], "2026-07-15"), "2026-07-13");
  assert.equal(earliestKnownDate([null, undefined], "2026-07-15"), "2026-07-15");
});
