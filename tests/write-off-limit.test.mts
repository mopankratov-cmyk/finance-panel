import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { DEFAULT_WAREHOUSE_LIMITS } from "../lib/auth/approvals.ts";
import { mergeLimits } from "../lib/auth/limitsStore.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/**
 * Пороги списания: хранение и применение.
 *
 * Права мало. Закупщику разрешено списывать — значит без порога он списал бы
 * любую сумму, и лимит, названный владельцем, остался бы текстом в документе.
 */

test("чужие ключи и мусор в пороги не проходят", () => {
  const merged = mergeLimits({ writeOffPerDocRub: 5000, привет: "мир", discrepancyRub: "не число" });
  assert.equal(merged.writeOffPerDocRub, 5000);
  assert.equal(merged.discrepancyRub, DEFAULT_WAREHOUSE_LIMITS.discrepancyRub);
  assert.equal(Object.keys(merged).length, 4);
});

test("отрицательный порог отбрасывается к умолчанию", () => {
  // Отрицательный порог не «строже», а бессмыслица: он запретил бы всё,
  // включая нулевую сумму.
  assert.equal(mergeLimits({ writeOffPerDocRub: -1 }).writeOffPerDocRub, DEFAULT_WAREHOUSE_LIMITS.writeOffPerDocRub);
});

test("доля больше единицы не сохраняется", () => {
  // «Сто с лишним процентов поставки» — порог, который не сработает никогда.
  assert.equal(mergeLimits({ discrepancyShare: 1.5 }).discrepancyShare, DEFAULT_WAREHOUSE_LIMITS.discrepancyShare);
  assert.equal(mergeLimits({ discrepancyShare: 0.1 }).discrepancyShare, 0.1);
});

test("ноль как порог сохраняется: это «всё на подпись», а не мусор", () => {
  assert.equal(mergeLimits({ writeOffPerDocRub: 0 }).writeOffPerDocRub, 0);
});

test("отсутствие таблицы даёт умолчания, а не отсутствие порогов", () => {
  // Иначе до применения миграции любая сумма проходила бы как «в пределах
  // лимита» — худший из возможных отказов, тихий.
  const source = read("../lib/auth/limitsStore.ts");
  assert.match(source, /return \{ \.\.\.DEFAULT_WAREHOUSE_LIMITS \}/);
  assert.match(source, /missingTable/);
});

test("неизвестная себестоимость не считается нулём", () => {
  // Ноль вместо неизвестного означал бы «списание бесплатное», и любой товар
  // без учётной цены стал бы дырой в пороге.
  const source = read("../lib/warehouse/writeoffLimit.ts");
  assert.match(source, /нет учётной себестоимости/);
  assert.match(source, /missing\.push/);
});

test("месячный итог берётся из журнала, а не из отдельного счётчика", () => {
  // Журнал неизменяем: накопленное нельзя обнулить, списав что-нибудь и
  // подчистив след. Отдельный счётчик разошёлся бы с историей на первом сбое.
  const source = read("../lib/warehouse/writeoffLimit.ts");
  assert.match(source, /from\("access_audit_log"\)/);
  assert.match(source, /eq\("action", "warehouse\.writeoff"\)/);
  assert.match(source, /costRub/);
});

test("подписывающий не спрашивает разрешения на своё списание", () => {
  // У руководителя и финдиректора порога нет: это решение владельца, а не
  // упущение, и оно должно быть видно в коде.
  assert.match(read("../lib/warehouse/writeoffLimit.ts"), /rolesCan\(roles, "finance\.approve"\)/);
});

test("порог проверяется ДО проводки, а не после", () => {
  // После проводки отказ уже ничего не отменяет: товар списан.
  const route = read("../app/api/warehouse/writeoffs/route.ts");
  const check = route.indexOf("checkWriteOffLimit(");
  const post = route.indexOf('rpc("post_writeoff"');
  assert.ok(check > 0 && post > 0 && check < post, "проверка порога должна стоять перед проводкой");
  assert.match(route, /Списание сверх лимита/);
});

test("стоимость списания попадает в журнал", () => {
  // По ней же считается месячный итог — без записи порог за месяц не работал бы.
  assert.match(read("../app/api/warehouse/writeoffs/route.ts"), /costRub: lastWriteOffCost/);
});

test("область порогов задаётся ролью, а не телом запроса", () => {
  // Иначе внешний клиент дотянулся бы до компанейских порогов, просто
  // передав чужую организацию.
  const route = read("../app/api/limits/route.ts");
  assert.match(route, /function scopeOf\(session: Session\)/);
  assert.match(route, /rolesAreExternal\(sessionRoles\(session\)\) \? session\.organization_id : null/);
  assert.doesNotMatch(route, /body\.organizationId|body\.organization_id/);
});

test("миграция порогов держит одну строку на область", () => {
  const sql = read("../supabase/migrations/202609100005_access_limits.sql");
  assert.match(sql, /create unique index if not exists access_limits_scope_unique/);
  // Вторая строка на ту же область означала бы два ответа на один вопрос.
  assert.match(sql, /coalesce\(organization_id/);
  assert.match(sql, /revoke all on table public\.access_limits from service_role/);
});
