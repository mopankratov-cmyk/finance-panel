import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import { ROLE_HOME, ROLE_LABEL, canAccess, isCabinetScopedRole } from "../lib/auth/roles";
import { isRole } from "../lib/auth/session";

/**
 * Роль «Менеджер Ozon»: человек ведёт кабинеты Ozon и товародвижение по ним.
 * Ему открыты ровно два модуля — «Ozon» и «Склад».
 */

test("менеджеру Ozon открыты только его два модуля", () => {
  for (const page of ["/", "/ozon", "/ozon/journal", "/ozon/economy", "/warehouse", "/warehouse/print"]) {
    assert.equal(canAccess("ozon_manager", page), true, `должно быть открыто: ${page}`);
  }
  // Финансовый контур компании, WB и системные настройки — не его работа.
  for (const page of ["/wb", "/wb/rnp", "/opiu", "/pnl", "/calendar", "/payments", "/costs", "/users", "/sync", "/cabinets", "/repricer"]) {
    assert.equal(canAccess("ozon_manager", page), false, `должно быть закрыто: ${page}`);
  }
});

test("роль опознаётся сессией и подписана по-русски", () => {
  assert.equal(isRole("ozon_manager"), true);
  assert.equal(ROLE_HOME.ozon_manager, "/ozon");
  assert.equal(ROLE_LABEL.ozon_manager, "Менеджер Ozon");
});

test("роль работает в выданном списке кабинетов", () => {
  // Признак вынесен отдельно: раньше каждое место сравнивало роль со строкой
  // «manager» и молча пропускало всё остальное — новая роль получила бы
  // доступ ко ВСЕМ кабинетам вместо выданных.
  assert.equal(isCabinetScopedRole("ozon_manager"), true);
  assert.equal(isCabinetScopedRole("manager"), true);
  assert.equal(isCabinetScopedRole("director"), false);
  assert.equal(isCabinetScopedRole("seller"), false);
  assert.equal(isCabinetScopedRole(null), false);
});

test("скоуп кабинетов применяется к новой роли во всех местах, где он был у менеджера", () => {
  const files = [
    "../lib/ozon/cabinet.ts",
    "../lib/auth/cabinetAccess.ts",
    "../app/api/cabinets/route.ts",
    "../lib/unit/groupListing.ts",
  ];
  for (const file of files) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(source, /isCabinetScopedRole/, `${file} должен спрашивать общий признак, а не сравнивать роль со строкой`);
    assert.equal(
      /role\s*===\s*"manager"/.test(source),
      false,
      `${file}: сравнение со строкой "manager" пропускает новую роль мимо ограничения`,
    );
  }
});

test("на /api/* новой роли открыты Ozon (только чтение) и склад, остальное закрыто", () => {
  const proxy = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
  assert.match(proxy, /session\.role === "ozon_manager" && !isOzonManagerApiAllowed/);
  const body = proxy.slice(proxy.indexOf("function isOzonManagerApiAllowed"), proxy.indexOf("// Менеджер маркетплейсов ведёт кабинеты"));
  // Склад — тем же набором, что у оператора фулфилмента: модуль один и тот же.
  assert.match(body, /isWarehouseApiAllowed/);
  // Кокпит только на чтение: записи в этом контуре нет.
  assert.match(body, /pathname\.startsWith\("\/api\/ozon\/"\)\) return method === "GET"/);
  assert.match(body, /return false;/);
  for (const forbidden of ["/api/opiu", "/api/costs", "/api/purchase-orders", "/api/users", "/api/repricer"]) {
    assert.ok(!body.includes(forbidden), `в разрешения менеджера Ozon попал ${forbidden}`);
  }
});

test("роль принимается формой сотрудников и сервером", () => {
  const page = readFileSync(new URL("../app/users/page.tsx", import.meta.url), "utf8");
  assert.match(page, /\["ozon_manager", "Менеджер Ozon"\]/);
  // Кабинеты выдаются так же, как менеджеру МП: без списка роль бессмысленна.
  assert.match(page, /role === "manager" \|\| role === "ozon_manager"/);
  const create = readFileSync(new URL("../app/api/users/route.ts", import.meta.url), "utf8");
  assert.match(create, /"ozon_manager"/);
});
