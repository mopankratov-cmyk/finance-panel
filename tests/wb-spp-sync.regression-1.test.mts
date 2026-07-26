import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("WB order and sale sync persist SPP as nullable provider facts", () => {
  const orders = readFileSync(new URL("../app/api/sync/orders/route.ts", import.meta.url), "utf8");
  const sales = readFileSync(new URL("../app/api/sync/sales/route.ts", import.meta.url), "utf8");

  assert.match(orders, /price_with_disc:\s*priceWithDiscFromOrder\(order\)/);
  assert.match(orders, /spp:\s*numericOrNull\(order\.spp\)/);
  assert.match(orders, /chunkedUpsertWithOptionalColumns\("wb_orders", rows, "srid", \["price_with_disc", "spp"\]/);

  assert.match(sales, /price_with_disc:\s*priceWithDiscFromSale\(sale\)/);
  assert.match(sales, /spp:\s*numericOrNull\(sale\.spp\)/);
  assert.match(sales, /chunkedUpsertWithOptionalColumns\("wb_sales", rows, "sale_id", \["price_with_disc", "spp"\]/);
});

test("WB SPP migration adds nullable columns without rewriting existing facts", () => {
  const migration = readFileSync(new URL("../supabase/migrations/20260726_wb_spp_sync.sql", import.meta.url), "utf8");

  assert.match(migration, /alter table if exists public\.wb_orders[\s\S]*add column if not exists price_with_disc numeric[\s\S]*add column if not exists spp numeric/i);
  assert.match(migration, /alter table if exists public\.wb_sales[\s\S]*add column if not exists price_with_disc numeric[\s\S]*add column if not exists spp numeric/i);
  assert.match(migration, /NULL means the provider did not return the value/i);
  assert.doesNotMatch(migration, /default\s+0/i);
});

test("WB sync health exposes price-before-SPP and nullable SPP coverage on the data quality screen", () => {
  const route = readFileSync(new URL("../app/api/wb/sync-health/route.ts", import.meta.url), "utf8");
  const page = readFileSync(new URL("../components/sync/SyncPage.tsx", import.meta.url), "utf8");

  assert.match(route, /fieldCoverageSnapshot\(db, cabinet\.id, "wb_orders", "price_with_disc", "Цена до СПП заказов"\)/);
  assert.match(route, /fieldCoverageSnapshot\(db, cabinet\.id, "wb_orders", "spp", "SPP% заказов"\)/);
  assert.match(route, /fieldCoverageSnapshot\(db, cabinet\.id, "wb_sales", "price_with_disc", "Цена до СПП продаж"\)/);
  assert.match(route, /fieldCoverageSnapshot\(db, cabinet\.id, "wb_sales", "spp", "SPP% продаж"\)/);
  assert.match(route, /fieldCoverage:\s*fieldCoverageByJob\.get\(source\.job\)/);
  assert.match(page, /fieldCoverage\?/);
  assert.match(page, /coverage\.label/);
});
