import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  OZON_AD_CABINET_TOTAL_SKU,
  OZON_AD_EMPTY_DAY_SKU,
  isOzonAdCabinetTotalSku,
  isOzonAdServiceSku,
} from "../lib/ozon/adDailyMarkers";

/**
 * Суточные итоги кабинета Ozon отдаёт сразу и за любой период, а разнесение
 * по товарам — асинхронными отчётами, по одному в минуту. Раньше экраны ждали
 * разнесения и показывали ноль при полностью доступной сумме.
 */

test("служебные строки никогда не попадают в разрез по товарам", () => {
  assert.equal(isOzonAdServiceSku(OZON_AD_EMPTY_DAY_SKU), true);
  assert.equal(isOzonAdServiceSku(OZON_AD_CABINET_TOTAL_SKU), true);
  assert.equal(isOzonAdServiceSku("1234567"), false, "настоящий SKU обязан считаться товаром");
  assert.equal(isOzonAdCabinetTotalSku(OZON_AD_CABINET_TOTAL_SKU), true);
  assert.equal(isOzonAdCabinetTotalSku(OZON_AD_EMPTY_DAY_SKU), false, "пустой день — не итог кабинета");
});

test("синк тянет суточные итоги первым делом и не пишет сегодняшний день", () => {
  const sync = readFileSync(new URL("../app/api/sync/ozon-adverts/route.ts", import.meta.url), "utf8");
  assert.match(sync, /async function syncCabinetDailyTotals/);
  assert.match(sync, /perfDailySpend\(creds, from, to\)/);
  assert.match(sync, /if \(day >= todayIso\) continue;/, "сегодняшний день ещё идёт — в историю не пишется");
  // Итоги должны собираться ДО работы с отчётами: иначе застрявшая очередь
  // отчётов снова оставила бы экраны с нулями. Сравниваем порядок ВЫЗОВОВ
  // внутри обработчика кабинета, а не порядок объявления функций в файле.
  const handler = sync.slice(sync.indexOf("cabinets.map(async (cabinet)"));
  const totalsAt = handler.indexOf("await syncCabinetDailyTotals");
  const backfillAt = handler.indexOf("await backfillOneDay");
  const reportAt = handler.indexOf("await perfProductReport");
  assert.ok(totalsAt > 0, "вызов суточных итогов должен быть в обработчике кабинета");
  assert.ok(totalsAt < backfillAt, "итоги обязаны идти раньше дозаполнения истории");
  assert.ok(totalsAt < reportAt, "итоги обязаны идти раньше заказа отчётов");
});

test("чтение раскладывает итоги кабинета отдельно от товаров", () => {
  const cockpit = readFileSync(new URL("../lib/ozon/cockpit.ts", import.meta.url), "utf8");
  assert.match(cockpit, /const cabinetTotals = new Map/);
  assert.match(cockpit, /isOzonAdCabinetTotalSku\(row\.sku\)/);
  // Складывать итог кабинета вместе со строками товаров нельзя — расход удвоится.
  assert.match(cockpit, /if \(isOzonAdServiceSku\(row\.sku\)\) continue;/);
});

test("журнал показывает суммы по дням даже без разнесения", () => {
  const route = readFileSync(new URL("../app/api/ozon/ad-journal/route.ts", import.meta.url), "utf8");
  assert.match(route, /isOzonAdCabinetTotalSku\(row\.sku\)/);
  assert.match(route, /skuTotals/, "итог дня из товаров нужен там, где суммы кабинета нет");
  const page = readFileSync(new URL("../components/ozon/OzonAdJournalPage.tsx", import.meta.url), "utf8");
  assert.match(page, /Расход по дням известен, разнесение по товарам ещё собирается/);
});

test("дозаполнение истории не считает день собранным по итогу кабинета", () => {
  const sync = readFileSync(new URL("../app/api/sync/ozon-adverts/route.ts", import.meta.url), "utf8");
  const probe = sync.slice(sync.indexOf("const { data: haveRows }"), sync.indexOf("const have = new Set"));
  // Итог кабинета приходит сразу за весь квартал. Если считать его признаком
  // сбора, дозаполнение решит, что собирать нечего, — разнесение по товарам
  // не наполнится уже никогда.
  assert.match(probe, /\.neq\("sku", OZON_AD_CABINET_TOTAL_SKU\)/);
});

test("пустой день не записывается поверх ненулевого итога кабинета", () => {
  const sync = readFileSync(new URL("../app/api/sync/ozon-adverts/route.ts", import.meta.url), "utf8");
  assert.match(sync, /Number\(totalRow\?\.spent \?\? 0\) > 0/);
  assert.match(sync, /расход есть, разнесение Ozon не отдал/);
});

test("история читается постранично — обрезка на тысяче строк занижала бы расход", () => {
  const reader = readFileSync(new URL("../lib/ozon/adDailyRead.ts", import.meta.url), "utf8");
  assert.match(reader, /\.range\(page \* PAGE, page \* PAGE \+ PAGE - 1\)/);
  for (const file of ["../lib/ozon/cockpit.ts", "../app/api/ozon/ad-journal/route.ts", "../app/api/ozon/rnp/route.ts"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(source, /readOzonAdDaily/, `${file} должен читать историю постранично`);
  }
});

test("итог дня в журнале складывается по каждому кабинету отдельно", () => {
  const route = readFileSync(new URL("../app/api/ozon/ad-journal/route.ts", import.meta.url), "utf8");
  // Общая куча теряла расход кабинета, у которого есть только разнесение.
  assert.match(route, /const known = cabinetTotals\.get\(clientId\)\?\.\[day\];/);
  assert.match(route, /total \+= known != null \? known : \(skuTotals\.get\(clientId\)\?\.\[day\] \?\? 0\);/);
});

test("план-факт берёт историю только когда она покрывает период целиком", () => {
  const rnp = readFileSync(new URL("../app/api/ozon/rnp/route.ts", import.meta.url), "utf8");
  assert.match(rnp, /const storedCoversPeriod = historyDates\.length > 0 && historyDates\.every/);
});
