import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/**
 * Экраны обещали то, чего не делали: кнопки, гарантированно отвечающие 403,
 * пустая колонка баркода, замершая после действия таблица и смена пароля,
 * которой не существовало.
 */

test("смена кабинета в поставках не оставляет пустой экран и не показывает чужие данные", () => {
  const page = read("../components/wb/WbSuppliesPage.tsx");
  assert.match(page, /setVisitedTabs\(needsSuppliesData \? \[\] : \[tab\]\);/);
  // Ключ включает кабинет: панель, которая грузится только по кнопке, иначе
  // осталась бы с данными прежнего кабинета.
  assert.match(page, /key=\{`\$\{cabinetId \?\? "all"\}:\$\{value\}`\}/);
});

test("скрытие предмета перезапускает сверку", () => {
  const tab = read("../components/wb/WbKizReconcileTab.tsx");
  assert.match(tab, /if \(firstReload\.current\) \{ firstReload\.current = false; return; \}/);
  assert.match(tab, /\}, \[reloadKey\]\);/);
});

test("баркод возврата берётся из сборочного задания по srid", () => {
  const store = read("../lib/wb/fbsKizStore.ts");
  assert.match(store, /barcodeBySrid/);
  assert.equal(/barcode: "",/.test(store), false, "колонка была пустой всегда");
});

test("кнопки синхронизации в юните закрыты для тех, кому роут отвечает 403", () => {
  const page = read("../components/wb/WbUnitPage.tsx");
  assert.match(page, /const canRunSync = canOperate && user\?\.role !== "seller";/);
  assert.match(page, /\{canRunSync \? actionButton\("prices"/);
});

test("обещание сменить пароль подкреплено роутом", () => {
  const route = read("../app/api/auth/password/route.ts");
  assert.match(route, /bcrypt\.compare\(currentPassword/);
  assert.match(route, /\.eq\("id", session\.uid\)/, "меняется только свой пароль");
  assert.match(route, /newPassword\.length < MIN_LENGTH/);
  const page = read("../app/wb/team/page.tsx");
  assert.match(page, /Сменить свой пароль/);
  assert.match(page, /api\/auth\/password/);
});
