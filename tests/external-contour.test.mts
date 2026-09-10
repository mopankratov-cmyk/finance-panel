import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  EXTERNAL_MODULES,
  MODULE_LABEL,
  allowsModulePath,
  isExternalModule,
  moduleOfPath,
  sessionModules,
} from "../lib/auth/modules.ts";
import { canAccess } from "../lib/auth/roles.ts";
import { rolesCan } from "../lib/auth/permissions.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/**
 * Внешний контур: отдельная компания внутри панели.
 *
 * Решение владельца: у клиента свой главный пользователь, он раздаёт доступ
 * своим сотрудникам по модулям, а данные не смешиваются с чужими ни при
 * каких условиях. Три оси должны сойтись: роль, область и модуль.
 */

test("клиенту открыты ровно три модуля", () => {
  assert.deepEqual([...EXTERNAL_MODULES], ["wb", "ozon", "warehouse"]);
  for (const module of EXTERNAL_MODULES) assert.ok(MODULE_LABEL[module], module);
  // Внутренние разделы компании модулем не считаются и клиенту не видны.
  for (const value of ["finance", "payroll", "users", "audit", ""]) {
    assert.equal(isExternalModule(value), false, value);
  }
});

test("путь относится к модулю одинаково на экране и в API", () => {
  // Иначе гейт закроет экран и пропустит запрос — или наоборот.
  for (const [path, expected] of [
    ["/wb/rnp", "wb"], ["/api/wb/losses", "wb"],
    ["/ozon", "ozon"], ["/api/ozon/cockpit", "ozon"],
    ["/warehouse", "warehouse"], ["/api/warehouse/stock", "warehouse"],
    // Поставки — часть складского контура: там принимают и отгружают.
    ["/supplies", "warehouse"], ["/api/supplies/receipts", "warehouse"],
    ["/pnl", null], ["/api/cabinets", null],
  ] as const) {
    assert.equal(moduleOfPath(path), expected, path);
  }
});

test("пустой список модулей означает «все», а не «ни одного»", () => {
  // У заведённых учёток клиентов модулей не проставляли. Прочитать пустоту
  // как запрет значило бы отключить живых людей в день выкладки.
  assert.deepEqual([...sessionModules({ role: "seller", modules: [] })], ["wb", "ozon", "warehouse"]);
  assert.deepEqual([...sessionModules({ role: "seller" })], ["wb", "ozon", "warehouse"]);
  assert.deepEqual([...sessionModules({ role: "seller", modules: ["wb", "мусор"] })], ["wb"]);
});

test("сотруднику клиента открыт только выданный модуль", () => {
  const onlyWb = { role: "seller" as const, modules: ["wb"] };
  assert.equal(allowsModulePath(onlyWb, "/wb/rnp"), true);
  assert.equal(allowsModulePath(onlyWb, "/api/wb/losses"), true);
  assert.equal(allowsModulePath(onlyWb, "/ozon"), false);
  assert.equal(allowsModulePath(onlyWb, "/api/ozon/cockpit"), false);
  assert.equal(allowsModulePath(onlyWb, "/warehouse"), false);
  assert.equal(allowsModulePath(onlyWb, "/api/supplies/receipts"), false);
});

test("внутренних сотрудников модулями не ограничивают", () => {
  // У них своя карта путей и своя матрица прав; третья ось им не нужна и
  // молча урезала бы доступ, который выдан ролью.
  for (const role of ["director", "fin_director", "wb_manager", "buyer", "warehouse"] as const) {
    assert.equal(allowsModulePath({ role, modules: ["wb"] }, "/ozon"), true, role);
    assert.equal(allowsModulePath({ role, modules: [] }, "/pnl"), true, role);
  }
});

test("Ozon открыт внешнему контуру и на экранах, и в API", () => {
  // Прежде он был закрыт вовсе: селлер не мог вести свои ozon-кабинеты, даже
  // когда они принадлежали его юрлицу.
  for (const role of ["seller", "seller_owner"] as const) {
    assert.equal(canAccess(role, "/ozon"), true, role);
    assert.equal(canAccess(role, "/wb/rnp"), true, role);
    assert.equal(canAccess(role, "/warehouse"), true, role);
  }
  assert.match(read("../proxy.ts"), /"\/api\/ozon\/",/);
});

test("внутренние разделы компании внешнему контуру закрыты", () => {
  // Граница между двумя компаниями — не про права, а про то, чьи это данные.
  for (const role of ["seller", "seller_owner"] as const) {
    for (const page of ["/pnl", "/payroll", "/users", "/audit", "/calendar", "/accounts"]) {
      assert.equal(canAccess(role, page), false, `${role} → ${page}`);
    }
    assert.equal(rolesCan([role], "finance.view"), false);
    assert.equal(rolesCan([role], "audit.view"), false);
  }
});

test("гейт спрашивает модуль и на страницах, и на API", () => {
  // Одна проверка вместо двух оставила бы половину контура открытой.
  const proxy = read("../proxy.ts");
  assert.match(proxy, /if \(!allowsModulePath\(session, pathname\)\) \{[\s\S]{0,200}status: 403/);
  assert.match(proxy, /!allowsModulePath\(session, pathname\) \|\| !canAccess\(sessionRoles\(session\), pathname\)/);
});

test("модули раздаёт клиент, а не мы, и запись переживает отсутствие колонки", () => {
  const team = read("../app/api/wb/team/route.ts");
  assert.match(team, /body\?\.modules/);
  assert.match(team, /filter\(isExternalModule\)/);
  // Роль остаётся внешней: заводить директоров и менеджеров панели отсюда нельзя.
  assert.match(team, /role: "seller"/);
  assert.match(team, /column .\*modules.\* does not exist/);
  // И это событие для журнала: клиент меняет доступ живому человеку.
  assert.match(team, /action: existing \? "user\.update" : "user\.create"/);
});

test("модули доезжают из базы в сессию", () => {
  assert.match(read("../lib/auth/users.ts"), /select\("id, email, role, roles, modules,/);
  assert.match(read("../app/api/auth/login/route.ts"), /modules: res\.user\.modules/);
  assert.match(read("../lib/auth/session.ts"), /Array\.isArray\(payload\.modules\)/);
});

test("миграция не превращает пустоту в запрет", () => {
  const sql = read("../supabase/migrations/202609100004_app_users_modules.sql");
  assert.match(sql, /add column if not exists modules text\[\]/);
  // Значения по умолчанию быть не должно: пустой список и так значит «все».
  assert.doesNotMatch(sql, /default '\{/);
  assert.match(sql, /notify pgrst/);
});
