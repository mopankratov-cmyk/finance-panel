import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/**
 * Синхронизации сообщали об успехе там, где данных не появилось. Зелёный
 * журнал при пустых экранах — самый дорогой вид молчания: разбираться никто не
 * идёт, потому что формально всё хорошо.
 */

test("заказы: полный отказ по лимиту WB — это не успех", () => {
  const route = read("../app/api/sync/orders/route.ts");
  assert.match(route, /const allDeferred = deferred\.length > 0 && nothingCollected;/);
  assert.match(route, /const ok = errors\.length === 0 && !allDeferred;/);
  assert.equal(
    /const ok = errors\.length === 0;\n\s*await writeSyncLog\("orders"/.test(route),
    false,
    "прежний расчёт возвращал ok при нулевом сборе",
  );
});

test("сборочные задания: упор в предел страниц не выдаётся за полный обход", () => {
  const route = read("../app/api/sync/fbs-orders/route.ts");
  assert.match(route, /let drained = false;/);
  assert.match(route, /\{ drained = true; break; \}/);
  assert.match(route, /status: drained \? "caught_up" : "running"/);
  // Курсор двигался на конец окна независимо от того, дочитали ли его.
  assert.match(route, /const frontier = drained \? startedAt\.toISOString\(\) : lastReadAt;/);
  assert.match(route, /incomplete/);
});

test("остатки FBO: исчезнувшая пара «товар — склад» обнуляется, а не живёт вечно", () => {
  const route = read("../app/api/sync/stocks/route.ts");
  assert.match(route, /\.from\("wb_stocks"\)\s*\n\s*\.update\(\{ quantity: 0, in_way_to_client: 0, in_way_from_client: 0/);
  assert.match(route, /\.lt\("synced_at", stamp\)/);
  // У кабинета с ограниченным ассортиментом чужие строки этим прогоном не
  // подтверждались — обнулять их нельзя.
  assert.match(route, /if \(isScoped\(t\.productScope\)\) \{\s*\n\s*staleQuery = staleQuery\.in\("nm_id"/);
  // Пустой ответ WB неотличим от «всё распродано» — обнулять по нему нельзя.
  assert.match(route, /if \(!db \|\| rows\.length === 0\) continue;/);
});

test("остатки FBS: обнуление только после полного обхода складов", () => {
  const route = read("../app/api/sync/fbs-stocks/route.ts");
  assert.match(route, /if \(!partial && catalog\.complete && rows\.length > 0\) \{/);
  assert.match(route, /\.from\("wb_fbs_stocks"\)\s*\n\s*\.update\(\{ quantity: 0/);
});

test("синк рекламы листает кампании и витрину, а не обрезает их на тысяче", () => {
  const route = read("../app/api/sync/advert-stats/route.ts");
  assert.match(route, /Синк рекламы: список кампаний/);
  assert.match(route, /Пересборка витрины рекламы/);
  assert.equal(/\.limit\(50_000\)/.test(route), false, "limit(50 000) не обходит потолок в тысячу строк");
});

test("экранные выборки, где терялись строки, читаются постранично", () => {
  assert.match(read("../app/api/repricer/decisions/route.ts"), /Репрайсер: решения/);
  assert.match(read("../app/api/ctrtest/adv-analysis/route.ts"), /CTR-тест: реклама по дням/);
  assert.match(read("../app/api/unit/table/route.ts"), /Unit: себестоимости/);
  assert.match(read("../app/api/unit/table/route.ts"), /Unit: отчёт за период/);
  assert.match(read("../lib/wb/commissions.ts"), /WB: кэш ставок по товарам/);
  assert.match(read("../lib/rnp/buildTable.ts"), /RNP: агрегат контура/);
});

test("постраничные выборки имеют полный порядок сортировки", () => {
  // Неполный порядок при листании страшнее отсутствия листания: строки на
  // стыке страниц дублируются или теряются, и цифра врёт незаметно.
  const advertStats = read("../app/api/sync/advert-stats/route.ts");
  assert.match(advertStats, /\.order\("nm_id"[\s\S]{0,80}\.order\("date"[\s\S]{0,300}\.order\("advert_id"/);
  const commissions = read("../lib/wb/commissions.ts");
  assert.match(commissions, /\.order\("cabinet_id", \{ ascending: true \}\)\s*\n\s*\.order\("nm_id", \{ ascending: true \}\)/);
});

test("обход складов FBS помнит, что оборвался на середине", () => {
  const route = read("../app/api/sync/fbs-stocks/route.ts");
  // fetchFbsStocks на исчерпании бюджета ВОЗВРАЩАЕТ complete:false, а не
  // бросает. Потерянный флаг = обнуление живого остатка.
  assert.match(route, /const \{ amounts, complete \} = await fetchFbsStocks/);
  assert.match(route, /if \(!complete\) walkComplete = false;/);
  assert.match(route, /const partial = visited < warehouses\.length \|\| !walkComplete;/);
});

test("курсор сборочных заданий двигается по просмотренному, а не по своему", () => {
  const route = read("../app/api/sync/fbs-orders/route.ts");
  // У агентского кабинета почти все задания чужие: по «своим» курсор у
  // кабинета без своих заданий в первых страницах замирал бы навсегда.
  assert.match(route, /if \(createdAt\) seenCreatedAt\.push\(createdAt\);/);
  assert.match(route, /const lastReadAt = seenCreatedAt\.sort\(\)\.at\(-1\) \?\? null;/);
});
