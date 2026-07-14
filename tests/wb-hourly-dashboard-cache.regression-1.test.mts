import assert from "node:assert/strict";
import test from "node:test";
import {
  HOURLY_DASHBOARD_CACHE_SECONDS,
  HOURLY_DASHBOARD_CACHE_VERSION,
  hourlyDashboardIdentity,
  hourlyDashboardTag,
} from "../lib/cache/hourlyDashboard";
import { wbDashboardWarmUrl } from "../lib/wb/dashboardWarmup";

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

test("hourly warmup targets every cabinet scope and the default market view", () => {
  const all = { cabinetId: null, label: "Все кабинеты" };
  const cabinet = { cabinetId: "cab-a", label: "Optima" };
  assert.equal(new URL(wbDashboardWarmUrl("https://panel.test", "sklejki", all)).searchParams.get("cabinet"), "all");
  const pulse = new URL(wbDashboardWarmUrl("https://panel.test", "market-pulse", cabinet, 123));
  assert.equal(pulse.pathname, "/api/market/pulse");
  assert.equal(pulse.searchParams.get("cabinet"), "cab-a");
  assert.equal(pulse.searchParams.get("subject_id"), "123");
  assert.equal(pulse.searchParams.get("weeks"), "4");
  assert.equal(pulse.searchParams.get("background"), "1");
  assert.equal(pulse.searchParams.has("refresh"), false);

  const seo = new URL(wbDashboardWarmUrl("https://panel.test", "seo", { cabinetId: "cab-a", label: "Cab A" }));
  assert.equal(seo.pathname, "/api/seo/skus");
  assert.equal(seo.searchParams.get("background"), "1");

  const funnel = new URL(wbDashboardWarmUrl("https://panel.test", "funnel-metrics", { cabinetId: "cab-a", label: "Cab A" }));
  assert.equal(funnel.pathname, "/api/design/day-metrics");
  assert.equal(funnel.searchParams.get("background"), "1");
});
