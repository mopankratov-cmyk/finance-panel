import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  aggregateClosedAdvertMetrics,
  getClosedMoscowPeriod,
} from "../lib/adverts/closedPeriodMetrics";

test("7-day comparison period contains seven closed Moscow dates and excludes today", () => {
  const period = getClosedMoscowPeriod(new Date("2026-07-18T08:00:00.000Z"));

  assert.deepEqual(period, {
    dateFrom: "2026-07-11",
    dateTo: "2026-07-17",
    dates: [
      "2026-07-11",
      "2026-07-12",
      "2026-07-13",
      "2026-07-14",
      "2026-07-15",
      "2026-07-16",
      "2026-07-17",
    ],
  });
  assert.ok(!period.dates.includes("2026-07-18"));
});

test("campaign aggregate returns spend, attributed revenue and attributed DRR for exact dates", () => {
  const result = aggregateClosedAdvertMetrics([
    { date: "2026-07-10", sum_spent: 999, sum_orders: 9_999 },
    { date: "2026-07-11", sum_spent: 100, sum_orders: 1_000 },
    { date: "2026-07-17T00:00:00.000Z", sum_spent: 50, sum_orders: 500 },
    { date: "2026-07-18", sum_spent: 777, sum_orders: 7_777 },
  ], getClosedMoscowPeriod(new Date("2026-07-18T08:00:00.000Z")));

  assert.deepEqual(result, {
    spent: 150,
    attributedRevenue: 1_500,
    attributedDrr: 10,
    status: "ready",
  });
});

test("spend without attributed revenue is explicit, while no spend stays neutral", () => {
  const period = getClosedMoscowPeriod(new Date("2026-07-18T08:00:00.000Z"));
  assert.deepEqual(aggregateClosedAdvertMetrics([
    { date: "2026-07-12", sum_spent: 25, sum_orders: 0 },
  ], period), {
    spent: 25,
    attributedRevenue: 0,
    attributedDrr: null,
    status: "no_attributed_orders",
  });
  assert.deepEqual(aggregateClosedAdvertMetrics([], period), {
    spent: 0,
    attributedRevenue: 0,
    attributedDrr: null,
    status: "no_spend",
  });
});

test("14-day guardrail inputs and fields remain separate from 7-day comparison metrics", () => {
  const route = readFileSync(new URL("../app/api/adverts/list/route.ts", import.meta.url), "utf8");

  assert.match(route, /revenue:\s*st\.ordSum/);
  assert.match(route, /spent:\s*st\.spent14/);
  assert.match(route, /spent_14:\s*Math\.round\(st\.spent14\)/);
  assert.match(route, /ad_revenue_14:\s*Math\.round\(st\.ordSum\)/);
  assert.match(route, /spent_7_closed:/);
  assert.match(route, /drr_attributed_7_closed:/);
});

test("adverts list includes completed campaigns in modern and legacy reads but counts only active", () => {
  const route = readFileSync(new URL("../app/api/adverts/list/route.ts", import.meta.url), "utf8");

  assert.equal(route.match(/\.in\("status", \[7, 9, 11\]\)/g)?.length, 2);
  assert.match(route, /campaign\.status === 9/);
});

test("modern and legacy campaign reads paginate deterministically and fail closed", () => {
  const route = readFileSync(new URL("../app/api/adverts/list/route.ts", import.meta.url), "utf8");

  assert.match(route, /const CAMPAIGN_PAGE_SIZE = 1000/);
  assert.match(route, /const CAMPAIGN_MAX_PAGES = 30/);
  assert.match(route, /loadAllCampaignPages<AdvertRow>/);
  const campaignReads = route.match(/\.from\("wb_adverts"\)[\s\S]*?\.range\(from, to\)/g) ?? [];
  assert.equal(campaignReads.length, 2);
  for (const read of campaignReads) {
    assert.match(read, /\.in\("status", \[7, 9, 11\]\)/);
    assert.match(read, /\.order\("advert_id", \{ ascending: true \}\)/);
  }
  assert.match(route, /if \(result\.error\) throw createCampaignPageError\(result\.error/);
  assert.match(route, /throw new Error\(`[^`]*\$\{pageSize \* maxPages\}[^`]*`\)/);
  assert.match(route, /catch \(error\) \{[\s\S]*?campaignPageErrorCode\(error\) !== "42703"[\s\S]*?throw error;[\s\S]*?loadAllCampaignPages<AdvertRow>/);
  assert.doesNotMatch(route, /Promise\.all\(\[[\s\S]*?modern[\s\S]*?legacy/);
  assert.match(route, /campaign\.status === 9/);
});

test("campaign and SKU facts use stable fail-closed pagination without a silent row limit", () => {
  const route = readFileSync(new URL("../app/api/adverts/list/route.ts", import.meta.url), "utf8");

  assert.match(route, /loadAllSupabasePages<StatRow>/);
  assert.match(route, /loadAllSupabasePages<NmDailyRow>/);
  assert.match(route, /from\("wb_advert_stats"\)[\s\S]*?order\("date", \{ ascending: true \}\)[\s\S]*?order\("advert_id", \{ ascending: true \}\)[\s\S]*?range\(from, to\)/);
  assert.match(route, /from\("wb_advert_nm_daily"\)[\s\S]*?order\("date", \{ ascending: true \}\)[\s\S]*?order\("nm_id", \{ ascending: true \}\)[\s\S]*?range\(from, to\)/);
  assert.doesNotMatch(route, /\.limit\(5000\)/);
});

test("campaign rows are grouped in one pass instead of rescanning full stats per advert", () => {
  const route = readFileSync(new URL("../app/api/adverts/list/route.ts", import.meta.url), "utf8");

  assert.doesNotMatch(route, /filter\(\(row\) => row\.advert_id === advert\.advert_id\)/);
  assert.match(route, /statRowsByAdvert\.get\(s\.advert_id\)/);
});

test("UI distinguishes campaign spend from comparable SKU spend and preserves DRR severity", () => {
  const route = readFileSync(new URL("../app/api/adverts/list/route.ts", import.meta.url), "utf8");
  const page = readFileSync(new URL("../components/wb/WbAdvertsPage.tsx", import.meta.url), "utf8");

  assert.match(route, /spent_sku_7_closed:/);
  assert.match(page, /Расход РК 7д/);
  assert.match(page, /Расход SKU 7д/);
  assert.match(page, /ДРР РК 7д/);
  assert.match(page, /no_attributed_orders[\s\S]*border-rose-200 bg-rose-50 text-rose-700/);
  assert.match(page, /no_spend[\s\S]*border-slate-200 bg-slate-50 text-slate-500/);
});
