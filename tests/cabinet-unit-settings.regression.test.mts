import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  isRejectedCabinetPct,
  normalizeCabinetPct,
  resolveExtraCommissionPct,
  resolveTaxPct,
} from "../lib/unit/cabinetSettings";
import { aggregateUnitContributions, type UnitContribution } from "../lib/unit/groupAggregation";
import { parseUnitMoneyQuery, UNIT_DEFAULT_TAX_PCT } from "../lib/unit/query";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

// Налог у каждой компании свой, а часть кабинетов работает через посредника со
// своей комиссией. Ни то, ни другое не выводится из API площадки — вводится руками.

test("пустое значение — это «не задано», а не ноль", () => {
  assert.equal(normalizeCabinetPct(""), null);
  assert.equal(normalizeCabinetPct(null), null);
  assert.equal(normalizeCabinetPct(undefined), null);
  // Осознанный ноль сохраняется как ноль.
  assert.equal(normalizeCabinetPct(0), 0);
  assert.equal(normalizeCabinetPct("0"), 0);
});

test("запятая как разделитель понимается, мусор — нет", () => {
  assert.equal(normalizeCabinetPct("7,5"), 7.5);
  assert.equal(normalizeCabinetPct("15.25"), 15.25);
  assert.equal(normalizeCabinetPct("abc"), null);
});

test("значение вне 0–100 отвергается, а не превращается в «не задано»", () => {
  assert.equal(isRejectedCabinetPct("-1"), true);
  assert.equal(isRejectedCabinetPct("101"), true);
  assert.equal(isRejectedCabinetPct("abc"), true);
  assert.equal(isRejectedCabinetPct(""), false);
  assert.equal(isRejectedCabinetPct("7"), false);
});

test("настройка кабинета важнее умолчания, запрос важнее настройки", () => {
  assert.deepEqual(resolveTaxPct({ requested: null, cabinet: null, fallback: 7 }), { taxPct: 7, source: "default" });
  assert.deepEqual(resolveTaxPct({ requested: null, cabinet: 15, fallback: 7 }), { taxPct: 15, source: "cabinet" });
  // «А что если» на экране должно перебивать сохранённую настройку.
  assert.deepEqual(resolveTaxPct({ requested: 6, cabinet: 15, fallback: 7 }), { taxPct: 6, source: "request" });
  // Ноль в настройке кабинета — это ставка 0%, а не отсутствие настройки.
  assert.deepEqual(resolveTaxPct({ requested: null, cabinet: 0, fallback: 7 }), { taxPct: 0, source: "cabinet" });
});

test("без настройки дополнительной комиссии нет", () => {
  assert.deepEqual(resolveExtraCommissionPct({ requested: null, cabinet: null }), { extraCommissionPct: 0, source: "none" });
  assert.deepEqual(resolveExtraCommissionPct({ requested: null, cabinet: 5 }), { extraCommissionPct: 5, source: "cabinet" });
  assert.deepEqual(resolveExtraCommissionPct({ requested: 2, cabinet: 5 }), { extraCommissionPct: 2, source: "request" });
});

test("отсутствие параметра tax отличается от tax=7", () => {
  // Иначе настройка кабинета никогда не сработала бы: её всегда перебивало бы умолчание.
  assert.equal(parseUnitMoneyQuery(new URLSearchParams()).taxPctRequested, null);
  assert.equal(parseUnitMoneyQuery(new URLSearchParams("tax=7")).taxPctRequested, UNIT_DEFAULT_TAX_PCT);
  assert.equal(parseUnitMoneyQuery(new URLSearchParams("extra=3")).extraCommissionPctRequested, 3);
});

const contribution = (over: Partial<UnitContribution>): UnitContribution => ({
  cabinetId: "cab-1",
  nmId: 1,
  article: "NV-01",
  orders: 10,
  revenue: 100_000,
  buyouts: 8,
  stock: 100,
  adSpend: 0,
  costPerUnit: 1000,
  marketplacePct: 20,
  acquiringPct: 2,
  ratesFactual: true,
  sppShare: 0,
  ...over,
});

test("в группе у каждого кабинета своя ставка налога", () => {
  const [row] = aggregateUnitContributions(
    [
      contribution({ cabinetId: "cab-1", revenue: 100_000, taxPct: 6 }),
      contribution({ cabinetId: "cab-2", revenue: 100_000, taxPct: 15 }),
    ],
    { taxPct: 7, ff: 0 },
  );
  // 100 000×6% + 100 000×15% = 21 000, а не 200 000×7% = 14 000.
  assert.equal(row.taxRub, 21_000);
});

test("кабинет без своей ставки считается общей", () => {
  const [row] = aggregateUnitContributions(
    [contribution({ revenue: 100_000, taxPct: null })],
    { taxPct: 7, ff: 0 },
  );
  assert.equal(row.taxRub, 7_000);
});

test("комиссия кабинета уменьшает маржу и видна отдельной суммой", () => {
  const [withExtra] = aggregateUnitContributions(
    [contribution({ revenue: 100_000, extraCommissionPct: 5, taxPct: 0 })],
    { taxPct: 0, ff: 0 },
  );
  const [without] = aggregateUnitContributions(
    [contribution({ revenue: 100_000, extraCommissionPct: null, taxPct: 0 })],
    { taxPct: 0, ff: 0 },
  );
  assert.equal(withExtra.extraCommissionRub, 5_000);
  assert.equal(without.extraCommissionRub, 0);
  assert.equal(Number(without.marginPerUnit) - Number(withExtra.marginPerUnit), 500);
});

test("WB-юнит применяет настройки кабинета и показывает базу", async () => {
  const route = await read("../app/api/unit/table/route.ts");
  assert.match(route, /loadCabinetUnitSettings/);
  assert.match(route, /const extraCommissionRub = price \* extraCommission\.extraCommissionPct \/ 100/);
  assert.match(route, /"Комиссия кабинета ₽"/);
  // Решатель целевой цены обязан учитывать комиссию посредника, иначе цель занижена.
  assert.match(route, /extraCommission\.extraCommissionPct \+ effectiveTaxPct/);
  // Ключ кэша обязан меняться вместе со ставками, иначе экран отдаст старый снимок.
  assert.match(route, /extraCommissionPct: extraCommission\.extraCommissionPct,/);
});

test("Ozon применяет те же настройки", async () => {
  const [route, cockpit] = await Promise.all([
    read("../app/api/ozon/unit/route.ts"),
    read("../lib/ozon/cockpit.ts"),
  ]);
  assert.match(route, /loadCabinetUnitSetting\(db, cab\.id\)/);
  assert.match(route, /extraCommissionRub/);
  assert.match(cockpit, /const cabinetTaxPct = cabinetSettings\?\.taxPct \?\? taxPct/);
  assert.match(cockpit, /commission: commission \+ extraCommission/);
});

test("настройки пишет только финансовая роль", async () => {
  const api = await read("../app/api/cabinet-settings/unit/route.ts");
  assert.match(api, /const WRITE_ROLES = \["director", "finance"\] as const/);
  assert.match(api, /requireApiSession\(\[\.\.\.WRITE_ROLES\]\)/);
  // Значение вне диапазона не должно молча стать «не задано».
  assert.match(api, /isRejectedCabinetPct/);
});
