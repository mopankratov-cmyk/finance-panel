import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canRunSyncManually, MANUAL_RUN_ROLES } from "../lib/sync/manualRunRoles";

/**
 * «Прогнать РК» на /wb/rk висела на canWrite — праве ОПИСЫВАТЬ (задачи,
 * заметки). Оно есть и у менеджера МП, и у селлера с уровнем в кабинете, а
 * роут гейтится ролью: менеджер получал голое английское «Unauthorized» после
 * цикла прогонов, селлер — сообщение про WB-аналитику в ответ на кнопку
 * синхронизации. Менеджер открывает журнал каждый день, то есть каждый день
 * видел живую кнопку, которая не работает.
 */
test("прогон руками разрешён владельцу и финотделу, и больше никому", () => {
  assert.equal(canRunSyncManually("director"), true);
  assert.equal(canRunSyncManually("fin_director"), true);
  assert.equal(canRunSyncManually("financier"), true);
  // "finance" — мёртвая роль из словаря до сентября 2026: такой роли не
  // существует в Role, ни одна сессия её не несёт. Раньше она стояла в
  // списке вместо fin_director/financier и молча запирала обоих.
  for (const role of ["finance", "manager", "seller", "warehouse", "ozon_manager", "", null, undefined]) {
    assert.equal(canRunSyncManually(role), false, String(role));
  }
  assert.deepEqual([...MANUAL_RUN_ROLES], ["director", "fin_director", "financier"]);
});

test("сервер и кнопка читают ОДИН список, а не два похожих", () => {
  const helpers = readFileSync(new URL("../lib/sync/helpers.ts", import.meta.url), "utf8");
  // Проверка обязана смотреть на ВСЕ роли сессии через sessionRoles(), а не
  // только на основную session.role — иначе сотрудник с несколькими ролями,
  // у которого нужная не первая, получает молчаливый отказ.
  assert.match(helpers, /sessionRoles\(session\)\.some\(\(?role\)? => canRunSyncManually\(role\)\)/);
  assert.doesNotMatch(helpers, /canRunSyncManually\(session\.role\)/, "проверка одной role — тот самый баг");
  assert.doesNotMatch(helpers, /new Set\(\["director", "finance"\]\)/, "второй копии списка быть не должно");

  const page = readFileSync(new URL("../components/wb/WbRkJournalPage.tsx", import.meta.url), "utf8");
  // Тот же баг был у кнопки: user?.role — тоже только основная роль.
  assert.doesNotMatch(page, /const canRunSync = canRunSyncManually\(user\?\.role\);/, "проверка одной role — тот самый баг");
  assert.match(page, /userRoles\.some\(\(?role\)? => canRunSyncManually\(role\)\)/);
  assert.match(page, /\{canRunSync \? \(/, "кнопка обязана исчезать, а не молча отказывать");
  assert.doesNotMatch(page, /disabled=\{!canWrite \|\| syncing/, "canWrite — не то право");
});

test("модуль списка ролей не тянет серверные импорты", () => {
  const source = readFileSync(new URL("../lib/sync/manualRunRoles.ts", import.meta.url), "utf8");
  // Смотрим на настоящие импорты, а не на любое вхождение: сам комментарий в
  // модуле объясняет, почему `next/server` там не место. Тип-импорт разрешён
  // отдельно — компилятор стирает его целиком, в бандл браузера он не попадает
  // (см. комментарий в manualRunRoles.ts).
  const imports = source
    .split("\n")
    .filter((line) => /^\s*import\b/.test(line) && !/^\s*import\s+type\b/.test(line));
  assert.deepEqual(imports, [], "модуль обязан остаться без РАНТАЙМ-импортов — его читает браузер");
});
