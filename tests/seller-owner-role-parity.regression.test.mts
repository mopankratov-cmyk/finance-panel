import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// proxy.ts пускает seller_owner дальше по общей карте прав (analytics.view и
// т.п.), но requireApiSession() внутри этих роутов сверял роль сессии с
// ручным списком, где был "seller", а "seller_owner" — нет. Главный
// пользователь клиента получал 403 там, где рядовой сотрудник ("seller")
// того же клиента работал нормально: Журнал РК, ручной порядок артикулов,
// настройки юнит-экономики, загрузка контента карточек, мониторинг «Полки».

const FILES = [
  "../app/api/wb/rk-journal/route.ts",
  "../app/api/sku-order/route.ts",
  "../app/api/wb/competitors/route.ts",
  "../app/api/cabinet-settings/unit/route.ts",
  "../app/api/content/role/route.ts",
  "../app/api/content/upload/route.ts",
  "../app/api/shelf/table/route.ts",
  "../app/api/shelf/watch/route.ts",
  "../app/api/unit/table/route.ts",
];

test("seller_owner стоит рядом с seller во всех ранее найденных ролевых списках", async () => {
  for (const path of FILES) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    const sellerMatches = source.match(/"seller"/g) ?? [];
    const sellerOwnerMatches = source.match(/"seller_owner"/g) ?? [];
    assert.ok(sellerMatches.length > 0, `${path}: строка "seller" исчезла — обнови список файлов теста`);
    assert.equal(
      sellerOwnerMatches.length,
      sellerMatches.length,
      `${path}: "seller_owner" должен встречаться там же и столько же раз, что и "seller" (${sellerOwnerMatches.length} vs ${sellerMatches.length})`,
    );
  }
});

test("unit/table: вторая, дублирующая проверка роли тоже идёт по sessionRoles, не по session.role", async () => {
  const source = await readFile(new URL("../app/api/unit/table/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(
    source,
    /\["director", "fin_director", "financier", "wb_manager", "ozon_manager", "seller", "seller_owner"\]\.includes\(session\.role\)/,
    "повторная проверка не должна смотреть только на первичную роль сессии — вторая роль сотрудника должна добавлять доступ",
  );
  assert.match(source, /sessionRoles\(session\)\.some\(\(role\) => \[.*"seller_owner"\]\.includes\(role\)\)/);
});
