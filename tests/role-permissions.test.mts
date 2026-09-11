import assert from "node:assert/strict";
import test from "node:test";
import {
  EXTERNAL_ROLES,
  ROLE_LABEL,
  ROLE_MARKETPLACES,
  ROLE_PERMISSIONS,
  isExternalRole,
  roleAllowsMarketplace,
  roleCan,
  rolesWith,
  type Permission,
  type Role,
} from "../lib/auth/permissions.ts";

/**
 * Критерии приёмки из ТЗ по ролям — прямо здесь, дословно.
 *
 * Матрица прав — это утверждение о том, как устроена компания, и проверять
 * его глазами по экрану нельзя: одна строка в таблице открывает финансы
 * фулфилменту, и заметят это через месяц. Каждый тест ниже назван так же,
 * как пункт §18, чтобы расхождение с ТЗ читалось из вывода прогона.
 */

const ALL_ROLES = Object.keys(ROLE_PERMISSIONS) as Role[];

const denied = (role: Role, permissions: Permission[]) => {
  for (const permission of permissions) {
    assert.equal(roleCan(role, permission), false, `${ROLE_LABEL[role]}: право «${permission}» выдано, а не должно`);
  }
};
const allowed = (role: Role, permissions: Permission[]) => {
  for (const permission of permissions) {
    assert.equal(roleCan(role, permission), true, `${ROLE_LABEL[role]}: право «${permission}» не выдано`);
  }
};

test("руководитель видит и редактирует все разделы", () => {
  // Единственная роль, которой можно всё: если у неё чего-то нет, значит
  // право забыли внести в матрицу целиком.
  const everything = new Set<Permission>();
  for (const role of ALL_ROLES) for (const p of ROLE_PERMISSIONS[role]) everything.add(p);
  for (const permission of everything) allowed("director", [permission]);
});

test("финансовый директор полностью управляет финансами без согласования", () => {
  allowed("fin_director", ["finance.view", "finance.edit", "finance.approve", "finance.period.close"]);
});

test("финансовый директор работает с отчётами всех кабинетов WB и Ozon", () => {
  allowed("fin_director", ["mp_reports.view", "mp_reports.sync", "mp_reports.classify"]);
  assert.deepEqual([...ROLE_MARKETPLACES.fin_director], ["wb", "ozon"]);
});

test("финансист имеет полный рабочий доступ к отчётам всех кабинетов", () => {
  allowed("financier", ["mp_reports.view", "mp_reports.sync", "mp_reports.classify"]);
  assert.deepEqual([...ROLE_MARKETPLACES.financier], ["wb", "ozon"]);
});

test("финансист не утверждает операции и не закрывает период", () => {
  // Ровно тот случай, ради которого право «утвердить» отделено от «изменить»:
  // готовит один, отвечает другой (ТЗ §15.1).
  allowed("financier", ["finance.edit"]);
  denied("financier", ["finance.approve", "finance.period.close"]);
});

test("финансовый директор добавляет сотрудников и назначает роли", () => {
  allowed("fin_director", ["users.manage", "users.roles.assign"]);
});

test("финансовый директор устанавливает и изменяет заработную плату", () => {
  allowed("fin_director", ["payroll.edit", "payroll.approve"]);
});

test("HR не назначает системные права", () => {
  denied("hr", ["users.manage", "users.roles.assign"]);
});

test("HR готовит зарплату, но не утверждает её", () => {
  allowed("hr", ["hr.edit", "payroll.edit"]);
  denied("hr", ["payroll.approve"]);
});

test("HR не видит финансы, отчёты маркетплейсов и аналитику", () => {
  denied("hr", ["finance.view", "mp_reports.view", "analytics.view", "cost.view", "ads.manage"]);
});

test("все внутренние менеджеры одного маркетплейса равны по правам", () => {
  // Роли старшего менеджера в ТЗ нет: если она заведётся, здесь станет видно.
  assert.deepEqual([...ROLE_PERMISSIONS.wb_manager].sort(), [...ROLE_PERMISSIONS.ozon_manager].sort());
});

test("менеджер WB не заходит в контур Ozon, и наоборот", () => {
  assert.equal(roleAllowsMarketplace("wb_manager", "wb"), true);
  assert.equal(roleAllowsMarketplace("wb_manager", "ozon"), false);
  assert.equal(roleAllowsMarketplace("ozon_manager", "ozon"), true);
  assert.equal(roleAllowsMarketplace("ozon_manager", "wb"), false);
});

test("обычный внутренний менеджер видит себестоимость, но не меняет её", () => {
  for (const role of ["wb_manager", "ozon_manager"] as Role[]) {
    allowed(role, ["cost.view"]);
    denied(role, ["cost.edit"]);
  }
});

test("менеджер не ходит в финансы компании и в отчёты маркетплейсов", () => {
  for (const role of ["wb_manager", "ozon_manager"] as Role[]) {
    denied(role, ["finance.view", "finance.edit", "mp_reports.view", "mp_reports.sync", "payroll.view", "users.manage"]);
  }
});

test("закупщик редактирует закупочные цены и себестоимость", () => {
  allowed("buyer", ["purchase.manage", "cost.view", "cost.edit"]);
});

test("закупщик подтверждает складские расхождения", () => {
  // §15.4: акт заводит фулфилмент, подтверждает закупщик или руководитель.
  allowed("buyer", ["warehouse.approve"]);
});

test("закупщик не трогает банк, зарплату, рекламу и учётные записи", () => {
  denied("buyer", ["finance.edit", "payroll.view", "ads.manage", "users.manage"]);
});

test("сотрудник фулфилмента не видит себестоимость, финансы и аналитику", () => {
  // Раньше в панели действовало обратное решение — оператор видел внутри
  // модуля всё, включая себестоимость. ТЗ §11 его отменяет.
  denied("warehouse", ["cost.view", "finance.view", "mp_reports.view", "analytics.view", "payroll.view"]);
});

test("сотрудник фулфилмента не утверждает собственное расхождение", () => {
  allowed("warehouse", ["warehouse.task.execute", "warehouse.request.create"]);
  denied("warehouse", ["warehouse.approve", "warehouse.stock.adjust"]);
});

test("внешний менеджер редактирует товары, цены и скидки своего юрлица", () => {
  for (const role of EXTERNAL_ROLES) allowed(role, ["catalog.edit", "price.edit", "supply.manage", "ads.manage"]);
});

test("внешний менеджер видит и редактирует себестоимость", () => {
  for (const role of EXTERNAL_ROLES) allowed(role, ["cost.view", "cost.edit"]);
});

test("внешний менеджер создаёт складские заявки, но не утверждает их", () => {
  for (const role of EXTERNAL_ROLES) {
    allowed(role, ["warehouse.request.create"]);
    denied(role, ["warehouse.approve", "warehouse.stock.adjust", "warehouse.task.execute"]);
  }
});

test("внешний менеджер не видит финансы компании, зарплату и отчёты маркетплейсов", () => {
  for (const role of EXTERNAL_ROLES) {
    denied(role, ["finance.view", "finance.edit", "mp_reports.view", "mp_reports.sync", "payroll.view", "settings.manage"]);
  }
});

test("у внешнего контура свой главный пользователь, и только он набирает команду", () => {
  // Клиент сам раздаёт доступ своим сотрудникам; наш директор в этом не участвует.
  allowed("seller_owner", ["users.manage"]);
  denied("seller", ["users.manage"]);
  denied("seller_owner", ["users.roles.assign"]);
});

test("внешнему контуру открыты оба маркетплейса", () => {
  // По решению владельца внешним селлерам доступны WB, Ozon и склад.
  // Прежде Ozon им был закрыт вовсе.
  for (const role of EXTERNAL_ROLES) {
    assert.equal(roleAllowsMarketplace(role, "wb"), true);
    assert.equal(roleAllowsMarketplace(role, "ozon"), true);
    assert.equal(isExternalRole(role), true);
  }
});

test("токены маркетплейсов не открыты никому", () => {
  // §2.9 — запрет общий. Право существует, чтобы запрет был выражен, а не забыт.
  assert.deepEqual(rolesWith("tokens.reveal"), []);
});

test("настройки системы остаются за руководителем", () => {
  assert.deepEqual(rolesWith("settings.manage"), ["director"]);
});

test("учётный остаток правят трое, и ни фулфилмент, ни внешний менеджер", () => {
  // Решение владельца от 09.09.2026: закупщик списывает сам в пределах
  // порога (10 000 ₽ на документ и 30 000 ₽ за месяц — lib/auth/approvals.ts),
  // финдиректор подписывает внутренние корректировки компании. Право говорит
  // «вправе ли», лимит — «на сколько»; без права закупщик не списал бы вовсе,
  // без лимита списал бы что угодно.
  assert.deepEqual(rolesWith("warehouse.stock.adjust").sort(), ["buyer", "director", "fin_director"]);
  for (const role of ["warehouse", "seller", "seller_owner", "financier", "wb_manager", "hr"] as Role[]) {
    assert.equal(roleCan(role, "warehouse.stock.adjust"), false, `${role} правит остаток руками`);
  }
});

test("неизвестная роль не получает ничего", () => {
  // Учётка со сломанным значением роли обязана упереться в отказ, а не
  // провалиться в права по умолчанию.
  for (const value of [null, undefined, "", "root", "admin", "manager", "finance"]) {
    assert.equal(roleCan(value, "analytics.view"), false, `роль «${String(value)}» получила доступ`);
    assert.equal(roleAllowsMarketplace(value, "wb"), false);
  }
});

test("у каждой роли есть подпись и список маркетплейсов", () => {
  for (const role of ALL_ROLES) {
    assert.ok(ROLE_LABEL[role], `у роли ${role} нет подписи`);
    assert.ok(Array.isArray(ROLE_MARKETPLACES[role]), `у роли ${role} не задан контур маркетплейсов`);
  }
});
