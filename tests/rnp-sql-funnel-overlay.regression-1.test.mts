import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  resolve(__dirname, "../supabase/migrations/20260721_rnp_sql_funnel_order_overlay.sql"),
  "utf8",
);

test("RNP SQL RPCs use WB funnel order totals before falling back to wb_orders", () => {
  for (const fn of ["rnp_daily", "rnp_daily_sku", "rnp_report"]) {
    assert.match(migration, new RegExp(`create or replace function public\\.${fn}\\(`));
  }

  assert.match(migration, /funnel_orders as \(/);
  assert.match(migration, /from public\.wb_funnel_daily/);
  assert.match(migration, /order_events as \(/);
  assert.match(migration, /from public\.wb_orders/);
  assert.match(migration, /case when coalesce\(f\.has_orders_count, false\) then coalesce\(f\.oc, 0\) else coalesce\(o\.oc, 0\) end as oc/);
  assert.match(migration, /case when coalesce\(f\.has_orders_sum, false\) then coalesce\(f\.os, 0\) else coalesce\(o\.os, 0\) end as os/);
});

test("RNP SQL report aggregates the daily funnel overlay instead of month-level all-or-nothing fallback", () => {
  assert.match(migration, /order_daily as \(/);
  assert.match(migration, /from order_daily od, bounds b/);
  assert.match(migration, /coalesce\(sum\(od\.oc\)[\s\S]*as c_month/);
  assert.match(migration, /coalesce\(sum\(od\.os\)[\s\S]*as s_month/);
});
