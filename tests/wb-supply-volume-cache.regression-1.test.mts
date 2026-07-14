import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { hourlyDashboardRevalidationProfile } from "../lib/cache/hourlyDashboard";
import { buildSupplyVolumeCoverage, productVolumeLiters } from "../lib/supplies/volumeCoverage";

test("WB card dimensions are converted from cubic centimeters to liters", () => {
  assert.equal(productVolumeLiters({ length: 40, width: 30, height: 10 }), 12);
  assert.equal(productVolumeLiters({ length: 12.5, width: 8, height: 4 }), 0.4);
  assert.equal(productVolumeLiters({ length: 0, width: 8, height: 4 }), null);
  assert.equal(productVolumeLiters({ length: null, width: 8, height: 4 }), null);
});

test("supply volume coverage counts only requested SKU with complete dimensions", () => {
  const coverage = buildSupplyVolumeCoverage([101, 102, 102, 103], [
    { nmId: 101, length: 40, width: 30, height: 10 },
    { nmId: 102, length: 20, width: null, height: 10 },
    { nmId: 999, length: 10, width: 10, height: 10 },
  ]);
  assert.deepEqual({ known: coverage.known, total: coverage.total }, { known: 1, total: 3 });
  assert.equal(coverage.litersByNm.get(101), 12);
  assert.equal(coverage.litersByNm.has(999), false);
});

test("PIM and supplies share an hourly card snapshot and no longer hard-code zero coverage", async () => {
  const cardsSource = await readFile(new URL("../lib/wb/cards.ts", import.meta.url), "utf8");
  const suppliesSource = await readFile(new URL("../app/api/supplies/route.ts", import.meta.url), "utf8");
  assert.match(cardsSource, /Promise\.all\(sources\.map/);
  assert.match(cardsSource, /"wb-pim-cards"/);
  assert.match(cardsSource, /Карточки WB загружены не полностью/);
  assert.match(suppliesSource, /loadCabinetPimRowsHourly/);
  assert.match(suppliesSource, /members\.map\(\(member\) => loadCabinetPimRowsHourly\(member\)\)/);
  assert.doesNotMatch(suppliesSource, /\.limit\(2000\)/);
  assert.match(suppliesSource, /const stockRows = allStockRows/);
  assert.doesNotMatch(suppliesSource, /vol_known:\s*0/);
});

test("sklejki paginates dashboard facts instead of caching Supabase's first page", async () => {
  const source = await readFile(new URL("../app/api/sklejki/route.ts", import.meta.url), "utf8");
  assert.match(source, /\.range\(page \* PAGE_SIZE, page \* PAGE_SIZE \+ PAGE_SIZE - 1\)/);
  assert.match(source, /Воронка WB превысила безопасный лимит/);
  assert.match(source, /Реклама WB превысила безопасный лимит/);
  assert.match(source, /Отзывы WB превысили безопасный лимит/);
});

test("scheduled hourly warmup keeps the previous good snapshot while revalidating", () => {
  assert.equal(hourlyDashboardRevalidationProfile({ backgroundRefresh: true }), "max");
  assert.deepEqual(hourlyDashboardRevalidationProfile({ forceRefresh: true }), { expire: 0 });
  assert.equal(hourlyDashboardRevalidationProfile({}), null);
});
