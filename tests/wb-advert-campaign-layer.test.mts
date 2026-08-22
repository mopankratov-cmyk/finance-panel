import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sync = readFileSync(new URL("../app/api/sync/advert-stats/route.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/202608220002_wb_advert_nm_campaign_daily.sql", import.meta.url), "utf8");

test("реклама по артикулу собирается из всех кампаний, а не из одного среза", () => {
  // Мигающие нули при включённой РК: fullstats идёт срезами по 50 кампаний, а
  // прежний агрегат (nm, день) строился из кампаний ТЕКУЩЕГО среза и апсертился
  // поверх полной суммы. Артикул в нескольких кампаниях из разных срезов
  // получал частичную сумму или ноль.
  assert.match(sync, /wb_advert_nm_campaign_daily/);
  assert.match(sync, /`\$\{adv\.advertId\}\|\$\{nm\.nmId\}\|\$\{date\}`/);
  assert.match(sync, /rebuildNmDailyFromCampaigns/);
  // Пока миграция не применена — честная деградация в прежний агрегат.
  assert.match(sync, /aggregateNmDaily\(campaignRows, t\.cabinetId\)/);
});

test("корзины из РК (atbs) попадают в слой — основа для CPL", () => {
  assert.match(sync, /atbs\?: number/);
  assert.match(sync, /agg\.carts \+= nm\.atbs \?\? 0/);
  assert.match(migration, /add column if not exists carts int/);
  // PostgREST upsert целится только в constraint по колонкам.
  assert.match(migration, /unique nulls not distinct \(cabinet_id, advert_id, nm_id, date\)/);
});
