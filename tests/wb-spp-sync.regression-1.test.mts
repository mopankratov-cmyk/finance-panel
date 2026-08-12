import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("WB order and sale sync persist SPP as nullable provider facts", () => {
  const orders = readFileSync(new URL("../app/api/sync/orders/route.ts", import.meta.url), "utf8");
  const sales = readFileSync(new URL("../app/api/sync/sales/route.ts", import.meta.url), "utf8");

  assert.match(orders, /price_with_disc:\s*priceWithDiscFromOrder\(order\)/);
  assert.match(orders, /spp:\s*numericOrNull\(order\.spp\)/);
  // Сторожим, что СПП остаётся в списке НЕОБЯЗАТЕЛЬНЫХ колонок, а не то, что список
  // состоит ровно из двух элементов: в него добавляются новые провайдерские факты.
  assert.match(orders, /chunkedUpsertWithOptionalColumns\("wb_orders", rows, "srid", \[[^\]]*"price_with_disc"[^\]]*"spp"[^\]]*\]/);

  assert.match(sales, /price_with_disc:\s*priceWithDiscFromSale\(sale\)/);
  assert.match(sales, /spp:\s*numericOrNull\(sale\.spp\)/);
  assert.match(sales, /chunkedUpsertWithOptionalColumns\("wb_sales", rows, "sale_id", \[[^\]]*"price_with_disc"[^\]]*"spp"[^\]]*\]/);
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

test("WB RNP uses stored order price before SPP instead of recalculating it", () => {
  const tableBuilder = readFileSync(new URL("../lib/rnp/buildTable.ts", import.meta.url), "utf8");
  const migration = readFileSync(
    new URL("../supabase/migrations/20260726_zz_wb_rnp_price_with_disc_consistency.sql", import.meta.url),
    "utf8",
  );

  assert.match(tableBuilder, /\.select\("nm_id, supplier_article, date, total_price, discount_percent, price_with_disc, is_cancel"\)/);
  assert.match(tableBuilder, /row\.orders_sum \+= orderPriceBeforeSpp\(order\)/);
  assert.match(migration, /coalesce\(price_with_disc,\s*coalesce\(total_price,\s*0\)\s*\*\s*\(1\s*-\s*coalesce\(discount_percent,\s*0\)\s*\/\s*100\.0\),\s*0\)/i);
  assert.match(migration, /now\(\) at time zone 'Europe\/Moscow'/i);
});
