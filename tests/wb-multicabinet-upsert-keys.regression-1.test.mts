import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("WB sync tables that feed RNP upsert by cabinet-scoped unique keys", () => {
  const funnelRoute = read("../app/api/sync/funnel/route.ts");
  const historyRecovery = read("../lib/wb/syncRecovery.ts");
  const advertStatsRoute = read("../app/api/sync/advert-stats/route.ts");
  const stocksRoute = read("../app/api/sync/stocks/route.ts");
  const advertsRoute = read("../app/api/sync/adverts/route.ts");

  // Запись идёт через optional-columns (add_to_wishlist), ключ конфликта тот же.
  assert.match(funnelRoute, /chunkedUpsertWithOptionalColumns\("wb_funnel_daily", rows, "cabinet_id,nm_id,date", \["add_to_wishlist"\]\)/);
  assert.doesNotMatch(funnelRoute, /chunkedUpsert\("wb_funnel_daily", rows, "nm_id,date"\)/);

  assert.match(historyRecovery, /chunkedUpsert\("wb_funnel_daily", rows, "cabinet_id,nm_id,date", 100_000\)/);
  assert.doesNotMatch(historyRecovery, /chunkedUpsert\("wb_funnel_daily", rows, "nm_id,date"/);

  assert.match(advertStatsRoute, /chunkedUpsert\("wb_advert_stats", dayRows, "cabinet_id,advert_id,date"\)/);
  assert.match(advertStatsRoute, /chunkedUpsert\("wb_advert_nm_daily", nmRows, "cabinet_id,nm_id,date"\)/);
  assert.doesNotMatch(advertStatsRoute, /chunkedUpsert\("wb_advert_stats", dayRows, "advert_id,date"\)/);
  assert.doesNotMatch(advertStatsRoute, /chunkedUpsert\("wb_advert_nm_daily", nmRows, "nm_id,date"\)/);

  assert.match(stocksRoute, /chunkedUpsert\("wb_stocks", rows, "cabinet_id,nm_id,warehouse"\)/);
  assert.doesNotMatch(stocksRoute, /chunkedUpsert\("wb_stocks", rows, "nm_id,warehouse"\)/);

  assert.match(advertsRoute, /chunkedUpsert\("wb_adverts", rows, "cabinet_id,advert_id"\)/);
  assert.match(advertsRoute, /chunkedUpsert\("wb_adverts", rows\.map\(\(\{ bid_cpm_rub, \.\.\.row \}\) => \(\{[\s\S]*?\}\)\), "cabinet_id,advert_id"\)/);
  assert.doesNotMatch(advertsRoute, /chunkedUpsert\("wb_adverts", rows, "advert_id"\)/);
});

test("WB cabinet-scoped unique key migration replaces legacy global uniqueness", () => {
  const migration = read("../supabase/migrations/20260721_wb_multicabinet_fact_unique_keys.sql");

  for (const oldConstraint of [
    "wb_stocks_nm_id_warehouse_key",
    "wb_funnel_daily_nm_id_date_key",
    "wb_advert_nm_daily_nm_id_date_key",
    "wb_adverts_advert_id_key",
    "wb_advert_stats_advert_id_date_key",
  ]) {
    assert.match(migration, new RegExp(`drop constraint if exists ${oldConstraint}`));
  }

  for (const uniqueIndex of [
    "on public.wb_stocks (cabinet_id, nm_id, warehouse) nulls not distinct",
    "on public.wb_funnel_daily (cabinet_id, nm_id, date) nulls not distinct",
    "on public.wb_advert_nm_daily (cabinet_id, nm_id, date) nulls not distinct",
    "on public.wb_adverts (cabinet_id, advert_id) nulls not distinct",
    "on public.wb_advert_stats (cabinet_id, advert_id, date) nulls not distinct",
  ]) {
    assert.match(migration, new RegExp(uniqueIndex.replace(/[().]/g, "\\$&")));
  }
});
