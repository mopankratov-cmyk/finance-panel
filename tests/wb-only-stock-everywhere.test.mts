import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isWbWarehouse, WB_WAREHOUSE_SQL_PATTERN } from "../lib/wb/realStock";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/**
 * Продолжение фильтра «Склад WB» (см. tests/wb-stock-filter-history.test.mts,
 * tests/rnp-stock-history.test.mts): места, которые считали остаток суммой по
 * ВСЕМ складам отчёта WB, включая фантомные строки городов после пожара, теперь
 * считают только «Склад WB» (FBW и FBS) — владелец, 21.09.2026.
 *
 * Часть этих мест — не чистые функции (роут `rk-autotask`, роут `seo/skus`), у
 * них здесь проверка по исходнику: тот же приём, что уже принят в проекте для
 * подобных мест (см. соседние *.regression-*.test.mts).
 */

test("rk-autotask: остаток для правила рекламы читается со склада строки и фильтруется по «Склад WB»", () => {
  const source = read("../app/api/sync/rk-autotask/route.ts");
  assert.match(source, /import \{ isWbWarehouse \} from "@\/lib\/wb\/realStock";/);
  assert.match(source, /\.select\("cabinet_id, nm_id, warehouse, quantity"\)/, "без склада строки в сумму попали бы фантомные города");
  const guard = source.indexOf("if (!isWbWarehouse(row.warehouse)) continue;");
  const sumLine = source.indexOf("stockByKey.set(key, (stockByKey.get(key)");
  assert.ok(guard > 0 && sumLine > guard, "фильтр должен стоять ДО накопления суммы по ключу");
});

test("seo/skus: остаток FBO складывается только по «Склад WB», FBS-остаток продавца не трогается", () => {
  const source = read("../app/api/seo/skus/route.ts");
  assert.match(source, /import \{ isWbWarehouse \} from "@\/lib\/wb\/realStock";/);
  assert.match(source, /\.select\("nm_id, warehouse, quantity"\)/);
  assert.match(source, /if \(!isWbWarehouse\(row\.warehouse\)\) continue;/);
  // wb_fbs_stocks — склад продавца (FBS), не склад WB: фильтр там не нужен и не должен появиться.
  const fbsBlock = source.slice(source.indexOf("loadFbsStocks"), source.indexOf("interface DailySkuRow"));
  assert.doesNotMatch(fbsBlock, /isWbWarehouse/);
});

test("rnp_report (SQL): остаток фильтруется по складу в самой агрегации, «в пути» — нет", () => {
  const sql = read("../supabase/migrations/202609220003_rnp_report_wb_warehouse_stock.sql");
  assert.match(sql, /create or replace function public\.rnp_report\(p_cabinet uuid default null\)/);
  const stockLine = sql.match(/coalesce\(sum\(quantity\)[^\n]*as stock,/)?.[0] ?? "";
  assert.match(stockLine, /filter \(where warehouse ~\* '\^склад\\s\+\(wb\|вб\)'\)/, "фильтр стоит в самом FILTER-агрегате, а не постфактум");
  assert.doesNotMatch(sql, /sum\(in_way_to_client\)\s*filter/, "«в пути» WB не делит по складам — суммируется по всем строкам, как раньше");
  // Тот же признак, что и в TypeScript — не два разных определения одного правила:
  // ищем ТЕКСТ шаблона внутри SQL-литерала, а не сопоставляем им сам SQL
  // (WB_WAREHOUSE_SQL_PATTERN начинается на `^` и матчился бы только с началом файла).
  assert.ok(sql.includes(WB_WAREHOUSE_SQL_PATTERN), "SQL и TypeScript должны использовать один и тот же шаблон, не два похожих");
});

test("rnp_report (SQL): тело функции не потеряло остальные CTE при правке", () => {
  const sql = read("../supabase/migrations/202609220003_rnp_report_wb_warehouse_stock.sql");
  for (const cte of ["order_events", "funnel_orders", "order_daily", "s as (", "meta as (", "ad as ("]) {
    assert.ok(sql.includes(cte), `пропало ${cte}`);
  }
  assert.match(sql, /full outer join st on st\.nm_id = coalesce\(o\.nm_id, s\.nm_id\)/);
});

test("app/api/supplies (потребность и «хватит дней»): читает остаток из rnp_report, отдельной правки не требует", () => {
  const source = read("../app/api/supplies/route.ts");
  assert.match(source, /loadRnpReportRows/, "потребность (need30/45/60) считается от stock из rnp_report — правка в SQL закрывает и этот экран");
});

test("признак «Склад WB» один на весь проект — TypeScript и SQL совпадают", () => {
  for (const name of ["Склад WB РФ", "Склад WB", "Склад ВБ", "  склад wb рф "]) assert.equal(isWbWarehouse(name), true, name);
  for (const name of ["Коледино", "Казань", "Электросталь", "", null, undefined]) assert.equal(isWbWarehouse(name as string), false, String(name));
});

test("остальные места чтения wb_stocks не суммируют остаток — их фильтр не касается", () => {
  // syncRecovery берёт только список nm_id кабинета (не quantity), фильтр по складу тут бессмыслен.
  assert.match(read("../lib/wb/syncRecovery.ts"), /\.select\("nm_id"\)/);
  // ctrProductBelongsToCabinet проверяет наличие строки (limit 1), не сумму.
  assert.match(read("../lib/ctrtest/metrics.ts"), /\.select\("id"\)\.eq\("cabinet_id", cabinetId\)\.eq\("nm_id", nmId\)\.limit\(1\)/);
});
