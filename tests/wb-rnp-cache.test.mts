import assert from "node:assert/strict";
import test from "node:test";
import { earliestKnownDate, latestDate, latestKnownDate, loadAllPages } from "../lib/rnp/buildTable";
import {
  currentMoscowMonth,
  WB_RNP_BACKGROUND_REFRESH,
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

test("WB RNP forecast schema invalidates the previous snapshot", () => {
  assert.equal(WB_RNP_CACHE_VERSION, "v5");
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
