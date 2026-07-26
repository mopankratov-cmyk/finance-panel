import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  HOURLY_DASHBOARD_CACHE_SECONDS,
  HOURLY_DASHBOARD_CACHE_VERSION,
  hourlyDashboardIdentity,
  hourlyDashboardTag,
} from "../lib/cache/hourlyDashboard";
import { wbDashboardWarmUrl } from "../lib/wb/dashboardWarmup";
import { WB_MARKET_DEFAULT_DAYS, WB_MARKET_DEFAULT_GRAN, wbMarketClosedDateRange } from "../lib/wb/marketDefaults";

test("hourly WB snapshot identity is stable and isolates scopes and periods", () => {
  const all = hourlyDashboardIdentity({ cabinetId: null, d1: "2026-07-01", d2: "2026-07-13" });
  const reordered = hourlyDashboardIdentity({ d2: "2026-07-13", d1: "2026-07-01", cabinetId: null });
  const cabinet = hourlyDashboardIdentity({ cabinetId: "cab-a", d1: "2026-07-01", d2: "2026-07-13" });
  const nextPeriod = hourlyDashboardIdentity({ cabinetId: null, d1: "2026-07-02", d2: "2026-07-14" });
  assert.equal(all, reordered);
  assert.notEqual(all, cabinet);
  assert.notEqual(all, nextPeriod);
});

test("hourly WB snapshot uses a compact versioned one-hour cache", () => {
  assert.equal(HOURLY_DASHBOARD_CACHE_SECONDS, 3_600);
  assert.equal(HOURLY_DASHBOARD_CACHE_VERSION, "v1");
  assert.match(hourlyDashboardTag("wb-sklejki", { cabinetId: "cab-a" }), /^dashboard:wb-sklejki:[a-f0-9]{32}$/);
});

test("WB market defaults to daily last 30 closed Moscow days", () => {
  assert.equal(WB_MARKET_DEFAULT_DAYS, 30);
  assert.equal(WB_MARKET_DEFAULT_GRAN, "day");
  assert.deepEqual(wbMarketClosedDateRange(30, Date.parse("2026-07-14T00:30:00.000Z")), {
    dateFrom: "2026-06-14",
    dateTo: "2026-07-13",
  });
});

test("hourly warmup targets every cabinet scope and the default market view", () => {
  const all = { cabinetId: null, label: "Все кабинеты" };
  const cabinet = { cabinetId: "cab-a", label: "Optima" };
  assert.equal(new URL(wbDashboardWarmUrl("https://panel.test", "sklejki", all)).searchParams.get("cabinet"), "all");
  const pulse = new URL(wbDashboardWarmUrl("https://panel.test", "market-pulse", cabinet, 123));
  assert.equal(pulse.pathname, "/api/market/pulse");
  assert.equal(pulse.searchParams.get("cabinet"), "cab-a");
  assert.equal(pulse.searchParams.get("subject_id"), "123");
  assert.equal(pulse.searchParams.get("gran"), "day");
  assert.equal(pulse.searchParams.has("weeks"), false);
  assert.match(pulse.searchParams.get("date_from") ?? "", /^\d{4}-\d{2}-\d{2}$/);
  assert.match(pulse.searchParams.get("date_to") ?? "", /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(
    (Date.parse(`${pulse.searchParams.get("date_to")}T00:00:00.000Z`) - Date.parse(`${pulse.searchParams.get("date_from")}T00:00:00.000Z`)) / 86_400_000,
    WB_MARKET_DEFAULT_DAYS - 1,
  );
  assert.equal(pulse.searchParams.get("refresh"), "1");
  assert.equal(pulse.searchParams.has("background"), false);

  const seo = new URL(wbDashboardWarmUrl("https://panel.test", "seo", { cabinetId: "cab-a", label: "Cab A" }));
  assert.equal(seo.pathname, "/api/seo/skus");
  assert.equal(seo.searchParams.get("refresh"), "1");

  const funnel = new URL(wbDashboardWarmUrl("https://panel.test", "funnel-metrics", { cabinetId: "cab-a", label: "Cab A" }));
  assert.equal(funnel.pathname, "/api/design/day-metrics");
  assert.equal(funnel.searchParams.get("refresh"), "1");
});

test("WB warmup reuses per-cabinet PIM snapshots and does not wait for every long cursor", async () => {
  const [cards, warmup, route] = await Promise.all([
    readFile(new URL("../lib/wb/cards.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/wb/dashboardWarmup.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/sync/dashboard-cache/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(cards, /loadCabinetPimRowsHourly\(cabinet\.id, options\)/);
  assert.match(cards, /for \(const cabinet of cabinets\)/);
  assert.doesNotMatch(cards, /Promise\.all\(cabinets\.map\(\(cabinet\) => loadCabinetPimRowsHourly/);
  assert.match(warmup, /const pim = await warmPimCards/);
  assert.doesNotMatch(warmup, /nichesResult, pim, unit/);
  assert.doesNotMatch(route, /if \(!readiness\.ready \|\| !progressReadiness\.ready\)/);
  assert.match(route, /readiness: \{ ready:/);
});
