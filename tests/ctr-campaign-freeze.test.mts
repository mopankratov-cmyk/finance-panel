import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

import { activeCtrTestForCampaign, activeCtrTestForNm, ctrFreezeMessage } from "../lib/ctrtest/freeze.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/**
 * Фаза C методологии CTR-тестов (ТЗ владельца 15.09.2026): пока тест идёт,
 * ставку/ключевые фразы/статус кампании, которую он меряет, трогать нельзя.
 */

function fakeDb(rows: unknown[]) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    limit: () => builder,
    maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
  };
  return { from: () => builder };
}

function fakeErrorDb() {
  const builder = {
    select: () => builder,
    eq: () => builder,
    limit: () => builder,
    maybeSingle: () => Promise.resolve({ data: null, error: { message: "boom" } }),
  };
  return { from: () => builder };
}

test("активный тест по артикулу находится, если есть строка", async () => {
  const db = fakeDb([{ id: 7, nm_id: 12345, article: "NV-01-35" }]);
  const lock = await activeCtrTestForNm(db as never, "cabinet", 12345);
  assert.deepEqual(lock, { id: 7, nmId: 12345, article: "NV-01-35" });
});

test("нет строки — заморозки нет", async () => {
  const db = fakeDb([]);
  const lock = await activeCtrTestForNm(db as never, "cabinet", 12345);
  assert.equal(lock, null);
});

test("сбой запроса — заморозка отказывает открыто, не блокирует правку", async () => {
  const lock = await activeCtrTestForNm(fakeErrorDb() as never, "cabinet", 12345);
  assert.equal(lock, null, "постороннее падение чтения ctr_tests не должно останавливать ставку/статус кампании");
});

test("заморозка по кампании — та же форма ответа", async () => {
  const db = fakeDb([{ id: 3, nm_id: 999, article: null }]);
  const lock = await activeCtrTestForCampaign(db as never, "cabinet", 555);
  assert.deepEqual(lock, { id: 3, nmId: 999, article: null });
});

test("сообщение упоминает артикул/номер теста и куда идти", () => {
  const text = ctrFreezeMessage({ id: 7, nmId: 12345, article: "NV-01-35" });
  assert.match(text, /NV-01-35/);
  assert.match(text, /#7/);
  assert.match(text, /\/wb\/ctr/);
});

test("проверка заморозки по артикулу фильтрует running + test_type=ctr", () => {
  const lib = read("../lib/ctrtest/freeze.ts");
  const forNm = lib.slice(lib.indexOf("export async function activeCtrTestForNm"), lib.indexOf("export async function activeCtrTestForCampaign"));
  assert.match(forNm, /\.eq\("test_type", "ctr"\)/);
  assert.match(forNm, /\.eq\("status", "running"\)/);
});

test("ставка: заморозка проверяется на КАЖДЫЙ nmId пачки до любого вызова WB", () => {
  const route = read("../app/api/adverts/bid/route.ts");
  const guard = route.indexOf("activeCtrTestForNm");
  const wbCall = route.indexOf("setAdvertBids(context.token");
  assert.ok(guard > 0 && wbCall > 0);
  assert.ok(guard < wbCall, "заморозка должна стоять раньше первого обращения к WB — частичного применения пачки быть не должно");
  assert.match(route, /for \(const item of parsed\)/);
});

test("минус-фразы: заморозка стоит до чтения и записи набора", () => {
  const route = read("../app/api/adverts/minus/route.ts");
  const guard = route.indexOf("activeCtrTestForNm");
  const setCall = route.indexOf("setMinusPhrases(");
  assert.ok(guard > 0 && guard < setCall);
});

test("одиночный старт/пауза/стоп кампании: заморозка по advert_id, не по nm_id", () => {
  const route = read("../app/api/adverts/action/route.ts");
  assert.match(route, /activeCtrTestForCampaign\(context\.db, context\.cabinet\.id, advertId\)/);
  const guard = route.indexOf("activeCtrTestForCampaign");
  const lifecycleCall = route.indexOf("setAdvertLifecycle(context.token");
  assert.ok(guard < lifecycleCall);
});

test("массовое действие: замороженная кампания пропускается, а не останавливает всю пачку", () => {
  const route = read("../app/api/adverts/bulk/route.ts");
  const loopStart = route.indexOf("for (let index = 0; index < ids.length");
  const guard = route.indexOf("activeCtrTestForCampaign", loopStart);
  assert.ok(guard > loopStart, "проверка должна быть внутри цикла — на каждую кампанию своя");
  const guardBlock = route.slice(guard, guard + 200);
  assert.match(guardBlock, /continue/, "заблокированная кампания не должна прерывать обработку остальных в пачке");
});

test("автоправила ставок: заморозка не блокирует сухой прогон, только боевое применение", () => {
  const route = read("../app/api/adverts/rules/run/route.ts");
  const dryRunIdx = route.indexOf("if (dryRun) {");
  const guardIdx = route.indexOf("activeCtrTestForNm(db, cabinetId, item.nmId)");
  const applyIdx = route.indexOf("const applied = await setAdvertBids(token,");
  assert.ok(dryRunIdx > 0 && guardIdx > 0 && applyIdx > 0);
  assert.ok(dryRunIdx < guardIdx, "сухой прогон (предпросмотр) должен пройти мимо заморозки — он ничего не пишет");
  assert.ok(guardIdx < applyIdx, "заморозка должна стоять до реального вызова WB");
});
