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
  assert.equal(isCabinetScopedRole("wb_manager"), true);
  assert.equal(isCabinetScopedRole("director"), false);
  // Внешний контур тоже работает в выданном списке — и это ужесточение.
  // Раньше признак его не покрывал, и ограничение держалось на россыпи
  // отдельных сравнений `role === "seller"`; там, где такого сравнения не
  // случилось (кабинеты Ozon), список не резался вовсе.
  assert.equal(isCabinetScopedRole("seller"), true);
  assert.equal(isCabinetScopedRole("seller_owner"), true);
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
  // Узкие списки API писались на одну роль и применяются к сотруднику
  // РОВНО с этой ролью: вторая роль обязана добавлять доступ, а не
  // упираться в чужой запрет.
  assert.match(proxy, /roles\.length === 1 && roles\[0\] === "ozon_manager" && !isOzonManagerApiAllowed/);
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
  const picker = readFileSync(new URL("../components/access/RoleSelector.tsx", import.meta.url), "utf8");
  // Список ролей руками из формы убран: он строится из общего словаря, и
  // «Менеджер Ozon» появляется потому, что роль есть в словаре, а не потому,
  // что кто-то не забыл дописать строку. Прежний список отстал сразу же, как
  // роли разделили, и предлагал несуществующие. Сам выбор переехал в
  // RoleSelector, когда ролей у человека стало можно держать несколько, —
  // сторож переехал туда же, а не отвалился.
  assert.match(picker, /Object\.keys\(ROLE_LABEL\)/);
  assert.match(page, /<RoleSelector/);
  assert.equal(ROLE_LABEL.ozon_manager, "Менеджер Ozon");
  // Кабинеты выдаются так же, как менеджеру МП: без списка роль бессмысленна.
  // Выбор кабинетов включается признаком роли, а не перечислением двух имён:
  // перечисление молча пропускало бы каждую следующую роль со списком
  // кабинетов, и человеку не дали бы выбрать ни одного.
  assert.match(page, /roles\.some\(isCabinetScopedRole\) && !roles\.some\(isExternalRole\)/);
  const create = readFileSync(new URL("../app/api/users/route.ts", import.meta.url), "utf8");
  // Список ролей руками из формы убран: роли проверяются общим словарём,
  // и «ozon_manager» проходит потому, что он в словаре, а не потому, что
  // кто-то не забыл дописать строку.
  assert.match(create, /roles = requested\.filter\(isRole\)/);
  assert.equal(isRole("ozon_manager"), true);
});
