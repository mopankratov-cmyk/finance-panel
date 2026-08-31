import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import { isMachineReadRequest } from "../lib/auth/apiGuard";

/**
 * Прогрев кэшей ходил в экраны с `Bearer CRON_SECRET`: прокси его пускал, а
 * гейт роута требовал куку сессии и отвечал 401. Прогрев «Журнала РК» и
 * «Полок» не наполнял кэш НИ РАЗУ, и первый заход человека собирал экран с
 * нуля — те самые пять-семь секунд ожидания.
 */

const withSecret = (fn: () => void) => {
  const saved = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "test-secret";
  try { fn(); } finally {
    if (saved === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = saved;
  }
};

test("машинное чтение — только GET и только с известным секретом", () => {
  withSecret(() => {
    const get = new Request("https://panel/api/wb/rk-journal", { headers: { authorization: "Bearer test-secret" } });
    assert.equal(isMachineReadRequest(get), true);

    const post = new Request("https://panel/api/wb/rk-journal", { method: "POST", headers: { authorization: "Bearer test-secret" } });
    assert.equal(isMachineReadRequest(post), false, "мутации всегда требуют живую сессию");

    const wrong = new Request("https://panel/api/wb/rk-journal", { headers: { authorization: "Bearer other-secret" } });
    assert.equal(isMachineReadRequest(wrong), false);

    const none = new Request("https://panel/api/wb/rk-journal");
    assert.equal(isMachineReadRequest(none), false);
  });
});

test("без настроенного секрета дверь закрыта наглухо", () => {
  const saved = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;
  try {
    const request = new Request("https://panel/api/wb/rk-journal", { headers: { authorization: "Bearer " } });
    assert.equal(isMachineReadRequest(request), false);
  } finally {
    if (saved !== undefined) process.env.CRON_SECRET = saved;
  }
});

test("греющиеся экраны пускают прогрев, мутации — нет", () => {
  for (const path of ["../app/api/wb/rk-journal/route.ts", "../app/api/shelf/table/route.ts"]) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.match(source, /requireApiSessionOrMachine\(request, \[\.\.\.READ_ROLES\]\)/, path);
  }
  const guard = readFileSync(new URL("../lib/auth/apiGuard.ts", import.meta.url), "utf8");
  assert.match(guard, /if \(request\.method !== "GET"\) return false;/);
});
