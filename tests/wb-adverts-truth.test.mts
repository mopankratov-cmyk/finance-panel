import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("../app/api/adverts/list/route.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../components/wb/WbAdvertsPage.tsx", import.meta.url), "utf8");

/**
 * Экран рекламы уверенно показывал три вещи, которых не знал: тип каждой
 * кампании, полный расход за день и результат последней правки ставки.
 */

test("расход кампании без товаров не пропадает из итога", () => {
  // Кампания без nm_ids не ложится ни на один артикул, и вместе с ней из
  // итога исчезали её деньги — панель расходилась с кабинетом WB.
  assert.match(route, /spendTodayUnattributed \+= st\.today;/);
  assert.match(route, /const spendTodayTotal = spendTodayAttributed \+ Math\.round\(spendTodayUnattributed\);/);
  assert.match(route, /spend_unattributed: \{/);
  // И это названо на экране, иначе итог не сходится с суммой строк.
  assert.match(page, /без привязки к товару/);
});

test("товар чужого контура в неразнесённое не попадает", () => {
  // Это не «нечего привязать», а просто не наш кабинет: такие кампании
  // остаются за пределами среза целиком.
  assert.match(route, /if \(!requestAllowsNm\(rowAllowedNmIds, nm\)\) continue;/);
});

test("тип кампании и модель оплаты берутся из данных WB", () => {
  assert.match(route, /bid_type: String\(a\.bid_type \?\? ""\)/);
  assert.match(route, /payment: String\(a\.payment_type \?\? ""\)/);
  assert.match(route, /bid_type, payment_type/, "колонки надо запросить, иначе брать неоткуда");
  assert.equal(/bid_type: "unified",/.test(route), false, "выдуманный тип возвращаться не должен");
  assert.equal(/payment: "cpm",/.test(route), false);
  // Неизвестный тип — отдельный фильтр, а не молчаливая «единая».
  assert.match(page, /\['unknown', 'Тип неизвестен'\]/);
});

test("последняя правка ставки находится по тому статусу, который пишет журнал", () => {
  const guard = readFileSync(new URL("../lib/adverts/cabinetGuard.ts", import.meta.url), "utf8");
  assert.match(guard, /status: "ok" \| "error" \| "rejected";/);
  assert.match(route, /APPLIED_CHANGE_STATUSES = new Set\(\["ok", "success"\]\)/);
  assert.equal(
    /change\.status === "success"/.test(route),
    false,
    "журнал пишет ok — сравнение «до и после» не находило ни одной строки",
  );
});

test("создание сотрудника не переписывает существующего молча", () => {
  const users = readFileSync(new URL("../app/api/users/route.ts", import.meta.url), "utf8");
  assert.match(users, /if \(existing && !b\.replace_existing\)/);
  assert.match(users, /status: 409/);
  const ui = readFileSync(new URL("../app/users/page.tsx", import.meta.url), "utf8");
  assert.match(ui, /Перезаписать доступ/);
});

test("команда кабинета: перезапись коллеги требует подтверждения", () => {
  const route = readFileSync(new URL("../app/api/wb/team/route.ts", import.meta.url), "utf8");
  assert.match(route, /if \(existing && body\?\.replaceExisting !== true\)/);
  const ui = readFileSync(new URL("../app/wb/team/page.tsx", import.meta.url), "utf8");
  assert.match(ui, /replaceExisting: true/);
});

test("оборачиваемость называет, по скольким дням она посчитана", () => {
  const build = readFileSync(new URL("../lib/rnp/buildTable.ts", import.meta.url), "utf8");
  assert.match(build, /по \$\{turnoverObservedDays\} доступным дням из/);
});
