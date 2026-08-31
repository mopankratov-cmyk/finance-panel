import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("SEO and funnel dashboards drain all daily WB fact pages", async () => {
  const [seo, funnel] = await Promise.all([
    source("../app/api/seo/skus/route.ts"),
    source("../app/api/design/day-metrics/route.ts"),
  ]);
  assert.match(seo, /loadRnpDailySkuRows<DailySkuRow>/);
  assert.match(seo, /loadAllSupabasePages<FunnelRow>/);
  assert.match(seo, /loadAllSupabasePages<AdRow>/);
  assert.match(seo, /"wb-seo-skus"/);
  // Номер схемы кэша растёт с каждой правкой полезной нагрузки — пинить его
  // здесь незачем: тест про листание страниц, а не про версию снимка.
  assert.match(seo, /schema: \d+/);
  assert.match(funnel, /loadAllSupabasePages<FunnelRow>/);
  assert.match(funnel, /loadAllSupabasePages<AdRow>/);
  assert.match(funnel, /"wb-funnel-day-metrics"/);
  assert.match(funnel, /schema: \d+/);
});

test("market and review KPIs no longer stop at Supabase's first 1000 rows", async () => {
  const [pulse, reviews] = await Promise.all([
    source("../app/api/market/pulse/route.ts"),
    source("../app/api/reviews/route.ts"),
  ]);
  assert.match(pulse, /loadRnpDailySkuRows<\{ d: string; nm_id: number; orders_sum: number \}>/);
  assert.match(pulse, /loadRnpReportRows<\{ nm_id: number; orders_sum_month: number \}>/);
  assert.match(reviews, /loadAllSupabasePages<\{ rating: number \}>/);
});
