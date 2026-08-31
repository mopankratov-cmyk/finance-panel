import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import { evaluateRepricer } from "../lib/repricer/evaluate";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("репрайсер не предлагает повышение под видом снижения", () => {
  // Пол маржи выше текущей цены: снижать нечем. Раньше сюда подставлялся сам
  // пол, и стратегия «снизить на 5%» выдавала предложение ПОДНЯТЬ цену.
  const decision = evaluateRepricer(
    { gmroi: null, stock: 10, drr: 50, turnover: null, margin: -5, currentPrice: 1_000, cogs: 900, feeFraction: 0.3, currentRevenue: 1_000 },
    [{ id: 1, name: "Снизить", enabled: true, priority: 1, action: "dec_pct", amount: 5, marginFloor: 20, conditions: [{ metric: "drr", op: ">", value: 10 }] }],
  );
  assert.equal(decision.status, "skipped");
  assert.equal(decision.newPrice, null);
  assert.match(decision.note ?? "", /снижать нечем/);
});

test("ABC не считает прибыль по товару без себестоимости", () => {
  const route = read("../app/api/abc/route.ts");
  assert.match(route, /const costKnown = r\.cost != null && Number\(r\.cost\) > 0;/);
  assert.match(route, /const profit = costKnown \? Math\.round/);
  // Отдельный класс: «посчитать нечем» — не то же самое, что «убыточный».
  assert.match(route, /cls: "\?"/);
  assert.equal(/const TAX = 7;/.test(route), false, "ставка налога берётся из настроек кабинета");
  const page = read("../components/wb/WbAbcPage.tsx");
  assert.match(page, /"\?": \{ label: "Нет себестоимости"/);
});

test("файл вывода КИЗ содержит всю партию, а не первую тысячу", () => {
  const route = read("../app/api/warehouse/kiz/export/route.ts");
  assert.match(route, /async function loadBatchRows/);
  // Захват помечает всю партию, но ответ RPC обрезан тысячей строк: партию
  // надо перечитать по её номеру, иначе помеченные коды пропадут насовсем.
  assert.match(route, /claimed = await loadBatchRows\(db, batchId, entityId\);/);
  assert.match(route, /rows = await loadBatchRows\(db, batchId, scope\.entity\.id\);/);
  assert.equal(/\.limit\(CHZ_DOC_LIMIT\)/.test(route), false);
});

test("остатки FBS в воронке читаются постранично", () => {
  assert.match(read("../app/api/seo/skus/route.ts"), /Воронка: остатки FBS/);
});

test("синк продаж не рапортует успех при нулевом сборе", () => {
  const route = read("../app/api/sync/sales/route.ts");
  assert.match(route, /const allDeferred = deferred\.length > 0 && nothingCollected;/);
  assert.match(route, /const ok = errors\.length === 0 && !allDeferred;/);
});

test("пустой ответ WB не перепрыгивает курсор бэкфилла", () => {
  const route = read("../app/api/sync/orders/route.ts");
  assert.match(route, /const nextCursor = orders\.length \? statisticsCursor\(orders, dateFrom\) : null;/);
  assert.match(route, /const cursorToWrite = nextCursor \?\? saved\?\.cursor \?\? context\.dateFrom;/);
  assert.equal(
    /: new Date\(Date\.now\(\) - 2 \* 60 \* 60 \* 1000\)\.toISOString\(\)/.test(route),
    false,
    "прыжок на «сейчас минус два часа» терял несобранную историю",
  );
});

test("юнит вычитает подготовку и не рисует ДРР без выручки", () => {
  const route = read("../app/api/unit/table/route.ts");
  // Подготовка (упаковка, маркировка) вычитается в «Склейках» и ОПиУ — юнит
  // её игнорировал, и маржа не сходилась с соседними экранами.
  assert.match(route, /const prep = m\?\.storage \?\? 0;/);
  assert.match(route, /price - cost - ff - prep - marketplaceRub/);
  assert.match(route, /\(cost \+ ff \+ prep\) \/ den/);
  assert.match(route, /prepPerUnit: meta\.get\(row\.article\)\?\.storage \?\? 0,/);
  // ДРР без выручки — не ноль: SKU, спаливший бюджет без продаж, выглядел идеальным.
  assert.match(route, /const drr = rev > 0 \? \(ad \/ rev\) \* 100 : null;/);
});

test("средняя СПП кабинета не считается фактом SKU", () => {
  const lib = read("../lib/unit/sppRates.ts");
  assert.match(lib, /export function sppShareSourceForNm/);
  const route = read("../app/api/unit/table/route.ts");
  assert.match(route, /if \(sppShareSourceForNm\(sppRates, r\.nm_id\) === "own"\) sppKnown\+\+;/);
  assert.match(route, /по средней кабинета/);
});

test("калькулятор цены считает той же формулой, что колонка целевой цены", () => {
  const route = read("../app/api/unit/price-solver/route.ts");
  // Раньше в знаменателе были только комиссия и эквайринг: калькулятор требовал
  // цену заметно ниже, чем таблица на том же экране.
  assert.match(route, /rates\.marketplacePct[\s\S]{0,200}rates\.acquiringPct[\s\S]{0,200}extraCommissionPct[\s\S]{0,120}effectiveTaxPct[\s\S]{0,80}drrPct/);
  assert.match(route, /cogs: r\.cost != null && r\.cost > 0 \? r\.cost \+ prep : 0/);
  // Обрезка на 500 SKU перестала быть молчаливой.
  assert.match(route, /truncated: rnp\.length > LIMIT/);
  const page = read("../components/wb/WbUnitPage.tsx");
  assert.match(page, /показаны первые \$\{solver\.items\.length\} из/);
});

test("победитель CTR-теста требует минимального знаменателя", () => {
  const model = read("../lib/ctrtest/model.ts");
  assert.match(model, /denominator >= CTR_MIN_VIEWS/);
  assert.equal(/denominator > 0 \? numerator \/ denominator \* 100 : null/.test(model), false);
});
