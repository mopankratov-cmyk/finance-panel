import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const source = readFileSync(join(process.cwd(), "components/dashboard/ModulesHome.tsx"), "utf8");

test("dashboard launcher keeps removed tools out of the module catalog", () => {
  for (const removedTitle of ["Планирование", "Здоровье", "UGC Studio"]) {
    assert.equal(source.includes(`title: "${removedTitle}"`), false, removedTitle);
  }
});

test("на главной ровно пять модулей и ни одного лишнего", () => {
  // Главную сознательно сузили до пяти входов. CTR-тесты и Поставки никуда не
  // делись — они живут в боковом меню, и дублировать их плиткой не нужно.
  for (const title of ["РНП WB", "Ozon Cockpit", "Финансы", "Склад", "Кабинеты"]) {
    assert.match(source, new RegExp(`title: "${title}"`), title);
  }
  const modules = source.slice(source.indexOf("PRIMARY_MODULES"), source.indexOf("export function"));
  assert.equal((modules.match(/title: "/g) ?? []).length, 5, "плиток на главной должно остаться пять");
});

test("dashboard launcher resets legacy disclosure state once", () => {
  assert.match(source, /DISCLOSURE_STORAGE_KEY = "fp_dashboard_disclosure_v2"/);
});
