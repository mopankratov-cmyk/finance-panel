import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { auditContext } from "../lib/audit/log.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/**
 * Журнал действий по ТЗ §17.
 *
 * Требований к нему два, и оба легко провалить незаметно: он должен писать
 * каждое важное событие в одинаковой форме и никогда не ронять саму операцию.
 */

test("адрес берётся первым из цепочки прокси, а не заголовком целиком", () => {
  // За прокси в X-Forwarded-For лежит список: клиент, потом промежуточные
  // узлы. Записать его целиком значит завести в журнале «адрес» из трёх
  // разных машин, по которому потом никого не найти.
  const request = new Request("https://panel.local/api/x", {
    headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1, 10.0.0.2", "user-agent": "Panel/1.0" },
  });
  const context = auditContext(request, { uid: "u1", email: "a@b.c", role: "director", roles: ["director"] });
  assert.equal(context.ip, "203.0.113.9");
  assert.equal(context.userAgent, "Panel/1.0");
  assert.deepEqual(context.actor.roles, ["director"]);
});

test("роли пишутся все, а не только основная", () => {
  const context = auditContext(null, { uid: "u1", email: "a@b.c", role: "wb_manager", roles: ["wb_manager", "ozon_manager"] });
  assert.deepEqual(context.actor.roles, ["wb_manager", "ozon_manager"]);
});

test("событие без сессии записывается без автора, а не отменяется", () => {
  // Неудачный вход — это событие БЕЗ сессии, и оно журналируется тоже:
  // по одному отказу видно опечатку, по сотне за минуту — подбор пароля.
  const context = auditContext(null, null);
  assert.equal(context.actor.id, null);
  assert.deepEqual(context.actor.roles, []);
});

test("журнал не роняет операцию и не молчит об отказе", () => {
  const source = read("../lib/audit/log.ts");
  // Ни одного throw наружу: платёж не должен срываться из-за строки истории.
  assert.match(source, /Promise<AuditResult>/);
  assert.match(source, /catch \(error\)/);
  assert.match(source, /console\.error\("\[audit\] не записано"/);
  // Но отсутствие таблицы до миграции — не повод шуметь в логи каждым запросом.
  assert.match(source, /42P01/);
});

test("действия названы машинными метками, а не свободным текстом", () => {
  // «изменил цену» и «Изменение цены» — два разных фильтра и половина
  // истории мимо. Тип не даёт написать строку от руки.
  const source = read("../lib/audit/log.ts");
  assert.match(source, /export type AuditAction =/);
  for (const action of ["auth.login", "user.role.assign", "payroll.change", "cost.change", "price.change", "data.export"]) {
    assert.ok(source.includes(`"${action}"`), `нет метки ${action}`);
  }
});

test("вход, выход и неудачная попытка записываются", () => {
  assert.match(read("../app/api/auth/login/route.ts"), /action: "auth\.login\.failed"/);
  assert.match(read("../app/api/auth/login/route.ts"), /action: "auth\.login"/);
  assert.match(read("../app/api/auth/logout/route.ts"), /action: "auth\.logout"/);
});

test("выход читает сессию до того, как гасит куку", () => {
  // Иначе в журнале останется «кто-то вышел», а кто именно — уже неизвестно.
  const source = read("../app/api/auth/logout/route.ts");
  assert.ok(source.indexOf("getServerSession()") < source.indexOf("cookies.set(SESSION_COOKIE"));
});

test("пароль и его хеш в журнал не попадают", () => {
  // Хеш — такой же секрет, как сам пароль: в истории ему места нет.
  const byId = read("../app/api/users/[id]/route.ts");
  assert.match(byId, /const \{ password_hash: _hidden, \.\.\.visible \} = patch/);
  assert.doesNotMatch(byId, /after: patch\b/);
  assert.doesNotMatch(read("../app/api/users/route.ts"), /after: \{ \.\.\.userPatch/);
});

test("правка сотрудника пишет и старое значение, и новое", () => {
  // §17 требует оба. Читать «было» надо ДО записи — после уже поздно.
  const source = read("../app/api/users/[id]/route.ts");
  const readBefore = source.indexOf('select("email, role, roles, cabinet_ids, is_active")');
  const write = source.indexOf('.update(patch)');
  assert.ok(readBefore > 0 && readBefore < write, "«было» читается после записи — там уже новое значение");
});

test("заведение сотрудника и выдача области журналируются", () => {
  assert.match(read("../app/api/users/route.ts"), /action: existing \? "user\.update" : "user\.create"/);
  assert.match(read("../app/api/users/cabinet-access/route.ts"), /action: "user\.scope\.assign"/);
});

test("таблица журнала не привязана к кабинету и не даёт себя чистить", () => {
  const sql = read("../supabase/migrations/202609100002_access_audit_log.sql");
  // У входа в систему нет ни кабинета, ни склада: обязательное поле здесь
  // заставило бы записывать неправду.
  assert.match(sql, /cabinet_id\s+uuid,/);
  assert.match(sql, /entity_id\s+uuid,/);
  assert.doesNotMatch(sql, /cabinet_id\s+uuid not null/);
  // Право на удаление не выдаётся вообще никому — §17.
  assert.match(sql, /grant select, insert on table public\.access_audit_log to service_role/);
  assert.doesNotMatch(sql, /grant all on table public\.access_audit_log/);
  assert.match(sql, /actor_roles\s+text\[\]/);
  assert.match(sql, /ip\s+text/);
});
