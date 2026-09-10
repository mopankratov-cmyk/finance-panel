import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import {
  isManagerApiAllowed,
  isOzonManagerApiAllowed,
  isPublicApi,
  isSellerApiAllowed,
  isWarehouseApiAllowed,
} from "../proxy.ts";
import { apiPermissionFor } from "../lib/auth/apiPermissions.ts";
import { rolesCan, type Role } from "../lib/auth/permissions.ts";

/**
 * Включение проверки не должно запереть живых людей.
 *
 * Гейт теперь спрашивает две двери сразу: прежний узкий список путей роли и
 * новую карту прав. Пока проверка принадлежности кабинета пройдена не по
 * каждому роуту, такое сложение обязано только СУЖАТЬ доступ. Но сужать оно
 * должно осознанно: если карта закрывает то, что список открывал, значит в
 * карте ошибка, и человек завтра увидит 403 на работающем экране.
 *
 * Поэтому здесь считается пересечение: для каждого метода каждого роута, где
 * прежний список говорил «можно», карта прав тоже обязана сказать «можно».
 */

const API_DIR = fileURLToPath(new URL("../app/api", import.meta.url));
const APP_DIR = fileURLToPath(new URL("../app", import.meta.url));

function routeFiles(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) found.push(...routeFiles(full));
    else if (name === "route.ts") found.push(full);
  }
  return found;
}

const ROUTES = routeFiles(API_DIR).map((file) => {
  const src = readFileSync(file, "utf8");
  const declared = [...src.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)/g)].map((m) => m[1]);
  const reexported = [...src.matchAll(/export\s*\{([^}]*)\}\s*from/g)]
    .flatMap((m) => m[1].split(","))
    .map((name) => name.trim())
    .filter((name) => ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(name));
  return {
    url: "/" + relative(APP_DIR, file).replace(/\/route\.ts$/, ""),
    methods: [...new Set([...declared, ...reexported])],
  };
});

/** Роут с параметром в пути гейт видит подставленным — проверяем оба вида. */
const concreteUrls = (url: string) => [url, url.replace(/\[[^\]]+\]/g, "sample")];

/**
 * Какие ПРАВА роль теряет при включении проверки.
 *
 * Считать по путям бессмысленно: у менеджера их восемьдесят одна штука, и
 * такой список никто не вычитает. А «менеджер теряет ровно финансы, зарплату
 * и учётные записи» — утверждение, которое читается и проверяется.
 */
function lostPermissions(role: Role, allowed: (path: string, method: string) => boolean): string[] {
  const lost = new Set<string>();
  for (const route of ROUTES) {
    for (const method of route.methods) {
      for (const url of concreteUrls(route.url)) {
        if (isPublicApi(url, method)) continue;
        if (!allowed(url, method)) continue;
        const required = apiPermissionFor(route.url, method);
        // Роут со своим сторожем карта прав не закрывает.
        if (!required || "open" in required) continue;
        if (rolesCan([role], required.permission)) continue;
        lost.add(required.permission);
      }
    }
  }
  return [...lost].sort();
}

test("внешний менеджер теряет только складские операции и набор команды", () => {
  // Ровно то, что владелец подтвердил в §7: остатки и заявки — да, приёмка,
  // отгрузка и списание вместо фулфилмента — нет. Набирает команду главный
  // пользователь клиента, рядовой сотрудник — нет.
  assert.deepEqual(lostPermissions("seller", isSellerApiAllowed), [
    "purchase.manage", "settings.manage", "users.manage",
    "warehouse.approve", "warehouse.stock.adjust", "warehouse.task.execute",
  ]);
  // Аналитика, себестоимость, цены, реклама, поставки и заявки на склад
  // остаются — иначе внешний контур перестал бы работать.
  for (const permission of ["analytics.view", "cost.edit", "price.edit", "ads.manage", "supply.manage", "warehouse.view", "warehouse.request.create"] as const) {
    assert.equal(rolesCan(["seller"], permission), true, permission);
  }
});

test("главный пользователь клиента команду набирает", () => {
  assert.equal(rolesCan(["seller_owner"], "users.manage"), true);
  assert.deepEqual(lostPermissions("seller_owner", isSellerApiAllowed), [
    "purchase.manage", "settings.manage",
    "warehouse.approve", "warehouse.stock.adjust", "warehouse.task.execute",
  ]);
});

test("оператор склада теряет справочники, списание и отмену чужих документов", () => {
  // ТЗ §11 перечисляет это прямым запретом, и владелец подтвердил отмену
  // прежнего решения «внутри модуля видит всё».
  assert.deepEqual(lostPermissions("warehouse", isWarehouseApiAllowed), [
    "purchase.manage", "settings.manage", "warehouse.approve", "warehouse.stock.adjust",
  ]);
});

test("менеджер Ozon теряет складские операции, оставаясь с просмотром", () => {
  assert.deepEqual(lostPermissions("ozon_manager", isOzonManagerApiAllowed), [
    "purchase.manage", "settings.manage",
    "warehouse.approve", "warehouse.request.create", "warehouse.stock.adjust", "warehouse.task.execute",
  ]);
  assert.equal(rolesCan(["ozon_manager"], "warehouse.view"), true);
});

test("менеджер WB теряет финансы, зарплату, учётные записи и токены", () => {
  // Прежний список для менеджера был запрещающим: он закрывал несколько
  // финансовых путей и пропускал всё остальное — включая удаление
  // пользователей и кабинетов. Это не регрессия, а то, ради чего работа.
  assert.deepEqual(lostPermissions("wb_manager", (path) => isManagerApiAllowed(path)), [
    // Журнал действий — история чужих поступков, и ТЗ отдаёт её руководителю
    // и финдиректору. Прежний список для менеджера пропускал бы и её.
    "audit.view",
    "cost.edit", "finance.edit", "finance.view",
    // Пороги согласований задаёт руководство, а во внешнем контуре — главный
    // пользователь клиента. Менеджеру менять их незачем и нельзя.
    "limits.manage",
    "mp_reports.sync", "mp_reports.view",
    "payroll.edit", "payroll.view", "purchase.manage", "settings.manage",
    "users.manage", "users.roles.assign",
    "warehouse.approve", "warehouse.request.create", "warehouse.stock.adjust", "warehouse.task.execute",
  ]);
});

test("руководителю открыто всё, что вообще требует права", () => {
  // Единственная роль, которую гейт не должен ограничивать нигде: если он её
  // где-то запер, значит право не выдано никому и роут недостижим вовсе.
  const lost: string[] = [];
  for (const route of ROUTES) {
    for (const method of route.methods) {
      const required = apiPermissionFor(route.url, method);
      if (!required || "open" in required) continue;
      if (!rolesCan(["director"], required.permission)) lost.push(`${method} ${route.url} → ${required.permission}`);
    }
  }
  assert.deepEqual(lost, []);
});

test("гейт закрывает неописанный эндпоинт, а не пропускает его", () => {
  // Fail-closed: неизвестный путь — ошибка карты, и она обязана стоить
  // отказа, а не молчаливого пропуска.
  const proxy = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
  assert.match(proxy, /const required = apiPermissionFor\(pathname, req\.method\)/);
  assert.match(proxy, /if \(!required\) \{[\s\S]{0,200}status: 403/);
  assert.match(proxy, /!rolesCan\(roles, required\.permission\)/);
});

test("проверка прав стоит ПОСЛЕ прежних списков, а не вместо них", () => {
  // Порядок важен: сложение двух дверей может только сузить доступ. Замена
  // открыла бы внешнему контуру роуты, часть которых не проверяет кабинет.
  const proxy = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
  const seller = proxy.indexOf("isSellerApiAllowed(pathname, req.method)");
  const permission = proxy.indexOf("apiPermissionFor(pathname, req.method)");
  assert.ok(seller > 0 && permission > seller, "карта прав должна проверяться после узких списков ролей");
});
