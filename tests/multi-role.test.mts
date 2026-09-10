import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sessionRoles } from "../lib/auth/session.ts";
import { canAccess } from "../lib/auth/roles.ts";
import {
  isRole,
  primaryRole,
  rolesAllowMarketplace,
  rolesAreCabinetScoped,
  rolesAreExternal,
  rolesCan,
} from "../lib/auth/permissions.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/**
 * Сотрудник может держать несколько ролей.
 *
 * Решение владельца от 09.09.2026: человек, ведущий оба маркетплейса,
 * получает обе роли менеджера. Главное правило здесь одно — вторая роль
 * ДОБАВЛЯЕТ доступ. Стоит хоть одному месту посчитать иначе, и выдача роли
 * обернётся поражением в правах: сотруднику дали Ozon, а он потерял WB.
 */

test("права складываются: хватает одной разрешающей роли", () => {
  const both = ["wb_manager", "ozon_manager"] as const;
  assert.equal(rolesCan(both, "catalog.edit"), true);
  assert.equal(rolesAllowMarketplace(both, "wb"), true);
  assert.equal(rolesAllowMarketplace(both, "ozon"), true);
  // Одна роль — один контур, и это по-прежнему так.
  assert.equal(rolesAllowMarketplace(["wb_manager"], "ozon"), false);
});

test("запрет одной роли не отнимает выданного другой", () => {
  // Менеджер себестоимость не правит, закупщик правит. Вместе — правит:
  // иначе назначение второй роли уменьшало бы права, а не увеличивало.
  assert.equal(rolesCan(["wb_manager"], "cost.edit"), false);
  assert.equal(rolesCan(["wb_manager", "buyer"], "cost.edit"), true);
});

test("экран открыт, если его открывает хотя бы одна роль", () => {
  assert.equal(canAccess(["wb_manager"], "/ozon"), false);
  assert.equal(canAccess(["wb_manager", "ozon_manager"], "/ozon"), true);
  assert.equal(canAccess(["wb_manager", "ozon_manager"], "/wb/rnp"), true);
  // И ни одна из ролей не открывает финансы компании.
  assert.equal(canAccess(["wb_manager", "ozon_manager"], "/pnl"), false);
});

test("ограничение по кабинетам снимается только когда ВСЕ роли без ограничения", () => {
  // Иначе роль без ограничения по кабинетам молча урезалась бы соседней:
  // человек получил бы доступ уже, чем ему выдали.
  assert.equal(rolesAreCabinetScoped(["wb_manager"]), true);
  assert.equal(rolesAreCabinetScoped(["wb_manager", "ozon_manager"]), true);
  assert.equal(rolesAreCabinetScoped(["wb_manager", "buyer"]), false);
  assert.equal(rolesAreCabinetScoped([]), false);
});

test("внешний контур определяется по любой внешней роли", () => {
  assert.equal(rolesAreExternal(["seller"]), true);
  assert.equal(rolesAreExternal(["seller_owner"]), true);
  assert.equal(rolesAreExternal(["buyer", "wb_manager"]), false);
});

test("старая кука без списка ролей работает по одной роли", () => {
  // Подписанная сессия живёт неделю: человек с прежним токеном не должен
  // вылететь при выкладке.
  assert.deepEqual(sessionRoles({ role: "buyer" }), ["buyer"]);
  assert.deepEqual(sessionRoles({ role: "buyer", roles: [] }), ["buyer"]);
  assert.deepEqual(sessionRoles({ role: "wb_manager", roles: ["wb_manager", "ozon_manager"] }), ["wb_manager", "ozon_manager"]);
  assert.deepEqual(sessionRoles(null), []);
});

test("первая роль задаёт стартовый экран и подпись в журнале", () => {
  assert.equal(primaryRole(["ozon_manager", "wb_manager"]), "ozon_manager");
  assert.equal(primaryRole(["не-роль", "buyer"]), "buyer");
  assert.equal(primaryRole([]), null);
});

test("форма сотрудника проверяет роли по общему словарю, а не по своему списку", () => {
  // Тот список был написан руками и отстал: после разделения ролей он всё
  // ещё принимал «finance» и «manager», которых больше нет, и подставлял
  // несуществующую роль по умолчанию — заводил сотрудника, которому потом не
  // открылся бы ни один экран. Компилятор этого не видел: массив строк.
  const route = read("../app/api/users/route.ts");
  assert.match(route, /roles = requested\.filter\(isRole\)/);
  assert.doesNotMatch(route, /\["director", "finance", "manager"/, "вернулся список ролей, написанный руками");
  assert.match(route, /Неизвестная роль/);
});

test("внешнюю роль нельзя совместить с внутренней", () => {
  // Иначе сотрудник клиента получил бы права нашей компании — ровно то, что
  // ТЗ запрещает границей юрлица.
  assert.match(read("../app/api/users/route.ts"), /Внешнюю роль нельзя совмещать с внутренней/);
});

test("вход и запись сотрудника переживают отсутствие колонки roles", () => {
  // Код выкладывается раньше миграции, и в этот промежуток панель обязана
  // работать: 42703 у Postgres значит «нет такой колонки».
  assert.match(read("../lib/auth/users.ts"), /42703/);
  assert.match(read("../lib/auth/users.ts"), /select\("id, email, role, roles,/);
  assert.match(read("../app/api/users/route.ts"), /column .\*roles.\* does not exist/);
});

test("миграция добавляет колонку и переносит уже выданные роли", () => {
  const sql = read("../supabase/migrations/202609100001_app_users_roles.sql");
  assert.match(sql, /add column if not exists roles text\[\]/);
  assert.match(sql, /set roles = array\[role\]/);
  assert.match(sql, /notify pgrst/);
});

test("словарь ролей знает ровно те роли, что описаны в ТЗ", () => {
  for (const role of ["director", "fin_director", "financier", "hr", "wb_manager", "ozon_manager", "buyer", "warehouse", "seller_owner", "seller"]) {
    assert.equal(isRole(role), true, role);
  }
  for (const role of ["finance", "manager", "admin", "root"]) {
    assert.equal(isRole(role), false, role);
  }
});

test("нигде в коде нет второго списка ролей", () => {
  /**
   * Четыре раза подряд одна и та же ошибка.
   *
   * Копия списка ролей заводилась в lib/auth/session.ts (вход ломался для
   * шести новых ролей), в app/api/users/route.ts (форма писала
   * несуществующую роль), в app/users/page.tsx (предлагала снятые роли) и в
   * lib/auth/server.ts — последняя выключила первого же живого менеджера WB:
   * страницу он открывал, а любой запрос к данным отвечал «Требуется вход».
   *
   * Поэтому проверка ищет копии ПО ВСЕМУ коду, а не по списку подозреваемых:
   * список подозреваемых — это ровно та же ручная копия, только в тесте.
   */
  const roots = ["../lib", "../app", "../components", "../proxy.ts"];
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)) files.push(full);
    }
  };
  for (const root of roots) {
    const full = fileURLToPath(new URL(root, import.meta.url));
    if (statSync(full).isDirectory()) walk(full); else files.push(full);
  }

  // Перечисление ролей строками: три и больше подряд — это копия словаря.
  const listPattern = /"(?:director|fin_director|financier|hr|wb_manager|ozon_manager|buyer|warehouse|seller|seller_owner)"(?:\s*[,|]\s*"(?:director|fin_director|financier|hr|wb_manager|ozon_manager|buyer|warehouse|seller|seller_owner)"){2,}/;
  const offenders: string[] = [];
  for (const file of files) {
    if (file.endsWith("permissions.ts")) continue; // единственный законный дом словаря
    const source = readFileSync(file, "utf8");
    if (!listPattern.test(source)) continue;
    /**
     * Список ролей бывает двух видов, и только один из них — копия словаря.
     *
     * «Кому открыт этот роут» — законное перечисление: оно отвечает, кого
     * пускать сюда, и живёт рядом с самим роутом. А копия словаря отвечает
     * на другой вопрос — «бывает ли такая роль вообще» — и сверяет с
     * перечислением РОЛЬ, ПРИШЕДШУЮ ИЗВНЕ: из тела запроса, из базы, из
     * куки. Именно она отстаёт и выключает людей. По этому признаку и
     * различаем.
     */
    const validatesIncoming = /\b(b|body|payload|data|input)\.role\b|value === "director"/.test(source);
    if (validatesIncoming) offenders.push(file.split("/finance-panel/").pop() ?? file);
  }
  assert.deepEqual(offenders, [], `второй словарь ролей:\n  ${offenders.join("\n  ")}`);
});

test("проверка роли в сессии идёт по словарю", () => {
  // Именно эта строка выключила менеджера WB: страницу гейт пропускал по
  // подписанной куке, а getServerSession возвращал null, и каждый запрос к
  // данным отвечал «Требуется вход».
  const source = read("../lib/auth/server.ts");
  assert.match(source, /if \(!isRole\(data\.role\)\) return null;/);
  assert.doesNotMatch(source, /\["director", "finance", "manager"/);
});

test("роли и модули переживают перечитывание из базы", () => {
  // Без этого многоролевость и модули работали бы только до первого
  // обращения к данным: гейт видит их из куки, а роут — уже нет.
  const source = read("../lib/auth/server.ts");
  assert.match(source, /select\("id,email,role,roles,modules,/);
  assert.match(source, /roles: roles\.length \? roles : undefined/);
  assert.match(source, /modules: Array\.isArray\(data\.modules\)/);
});

test("словарь ролей в панели ровно один", () => {
  // Своя копия списка ролей уже жила в lib/auth/session.ts и отстала при их
  // разделении: verifySession сверял роль с перечнем «finance | manager | …»
  // и на любой НОВОЙ роли возвращал null. Для гейта это «человек не
  // залогинен» — финдиректор, HR, закупщик и менеджер WB не смогли бы войти
  // вовсе, а в проде уехали бы на /login по кругу. Компилятор молчал:
  // сравнение строк, не тип. Ищем такие копии текстом — иначе следующая
  // появится так же незаметно.
  const suspects = [
    "../lib/auth/session.ts",
    "../lib/auth/roles.ts",
    "../lib/auth/apiGuard.ts",
    "../proxy.ts",
  ];
  for (const file of suspects) {
    const source = read(file);
    const handwritten = /value === "director"|role === "director" \|\||\["director", "fin_director", "financier", "hr"/;
    assert.doesNotMatch(source, handwritten, `${file}: список ролей написан руками — он отстанет от словаря`);
  }
  // И сама проверка обязана быть перевывезена из словаря, а не объявлена заново.
  assert.match(read("../lib/auth/session.ts"), /export \{ isRole \} from "\.\/permissions"/);
});

test("список ролей доезжает из куки до гейта", () => {
  // Без этого многоролевость мертва: проверка увидит одну роль там, где
  // сотруднику выдали две, и вторая роль ничего не добавит.
  const source = read("../lib/auth/session.ts");
  assert.match(source, /Array\.isArray\(payload\.roles\)/);
  assert.match(source, /roles: roles\.length \? roles : undefined/);
});
