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
  assert.equal(canRunSyncManually("finance"), true);
  for (const role of ["manager", "seller", "warehouse", "ozon_manager", "", null, undefined]) {
    assert.equal(canRunSyncManually(role), false, String(role));
  }
  assert.deepEqual([...MANUAL_RUN_ROLES], ["director", "finance"]);
});

test("сервер и кнопка читают ОДИН список, а не два похожих", () => {
  const helpers = readFileSync(new URL("../lib/sync/helpers.ts", import.meta.url), "utf8");
  assert.match(helpers, /canRunSyncManually\(session\.role\)/);
  assert.doesNotMatch(helpers, /new Set\(\["director", "finance"\]\)/, "второй копии списка быть не должно");

  const page = readFileSync(new URL("../components/wb/WbRkJournalPage.tsx", import.meta.url), "utf8");
  assert.match(page, /const canRunSync = canRunSyncManually\(user\?\.role\);/);
  assert.match(page, /\{canRunSync \? \(/, "кнопка обязана исчезать, а не молча отказывать");
  assert.doesNotMatch(page, /disabled=\{!canWrite \|\| syncing/, "canWrite — не то право");
});

test("модуль списка ролей не тянет серверные импорты", () => {
  const source = readFileSync(new URL("../lib/sync/manualRunRoles.ts", import.meta.url), "utf8");
  // Смотрим на настоящие импорты, а не на любое вхождение: сам комментарий в
  // модуле объясняет, почему `next/server` там не место.
  const imports = source.split("\n").filter((line) => /^\s*import\b/.test(line));
  assert.deepEqual(imports, [], "модуль обязан остаться без импортов — его читает браузер");
});
