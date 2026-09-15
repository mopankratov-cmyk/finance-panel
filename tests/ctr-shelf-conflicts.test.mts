import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ensureCtrTestCampaignBinding, findCompetingShelfCampaigns, resolveCtrSearchCampaign } from "../lib/ctrtest/campaignBinding.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/**
 * Фаза A методологии CTR-тестов (ТЗ владельца 15.09.2026): тест меряется по
 * одной поисковой кампании, а не по сумме всех кампаний и полок на артикул.
 * Эти тесты про границы и порядок — самое дорогое здесь: сменить знаменатель
 * метрики посреди уже идущего теста, или тихо потерять осознанный отказ
 * человека от паузы полок.
 */

/** Достаточно верный ин-мемори движок фильтров, чтобы `.eq`/`.contains` в
 *  тестируемом коде реально что-то значили, а не были no-op в моке. */
function fakeDb(tables: Record<string, unknown[]>) {
  const calls: { table: string; op: string; payload?: unknown }[] = [];
  const builder = (table: string) => {
    let rows = [...(tables[table] ?? [])] as Record<string, unknown>[];
    const api = {
      select: () => api,
      eq: (field: string, value: unknown) => { rows = rows.filter((row) => row[field] === value); return api; },
      gte: () => api,
      contains: (field: string, values: unknown[]) => { rows = rows.filter((row) => Array.isArray(row[field]) && values.every((v) => (row[field] as unknown[]).includes(v))); return api; },
      in: (field: string, values: unknown[]) => { rows = rows.filter((row) => (values as unknown[]).includes(row[field])); return api; },
      is: (field: string, value: unknown) => { rows = rows.filter((row) => row[field] === value); return api; },
      order: () => api,
      update: (payload: unknown) => { calls.push({ table, op: "update", payload }); return { eq: () => Promise.resolve({ error: null }) }; },
      upsert: (payload: unknown) => { calls.push({ table, op: "upsert", payload }); return Promise.resolve({ error: null }); },
      insert: (payload: unknown) => { calls.push({ table, op: "insert", payload }); return Promise.resolve({ error: null }); },
      then: (resolve: (value: { data: unknown[]; error: null }) => void) => resolve({ data: rows, error: null }),
    };
    return api;
  };
  return { from: (table: string) => builder(table), calls };
}

test("резолюция кампании выбирает только поисковый блок, не полку и не ЕРК", async () => {
  const db = fakeDb({
    wb_advert_nm_campaign_daily: [
      { cabinet_id: "cabinet", nm_id: 1, advert_id: 1, spent: 500 },
      { cabinet_id: "cabinet", nm_id: 1, advert_id: 2, spent: 500 },
      { cabinet_id: "cabinet", nm_id: 1, advert_id: 3, spent: 500 },
    ],
    wb_adverts: [
      { advert_id: 1, name: "Поиск", bid_type: "manual", payment_type: "cpc", placement_search: true, placement_shelf: false },
      { advert_id: 2, name: "Полка", bid_type: "manual", payment_type: "cpc", placement_search: false, placement_shelf: true },
      { advert_id: 3, name: "ЕРК", bid_type: "unified", payment_type: null, placement_search: null, placement_shelf: null },
    ],
  });
  const resolution = await resolveCtrSearchCampaign(db as never, "cabinet", 1);
  assert.equal(resolution.status, "resolved");
  assert.equal(resolution.advertId, 1);
});

test("резолюция кампании отсекает расход ниже CTR_MIN_CAMPAIGN_SPEND", async () => {
  const db = fakeDb({
    wb_advert_nm_campaign_daily: [{ cabinet_id: "cabinet", nm_id: 1, advert_id: 1, spent: 5 }],
    wb_adverts: [{ advert_id: 1, name: "Поиск", bid_type: "manual", payment_type: "cpc", placement_search: true, placement_shelf: false }],
  });
  const resolution = await resolveCtrSearchCampaign(db as never, "cabinet", 1);
  assert.equal(resolution.status, "none");
  assert.equal(resolution.advertId, null);
});

test("два поисковых кандидата — ambiguous, не блокирует стартом", async () => {
  const db = fakeDb({
    wb_advert_nm_campaign_daily: [{ cabinet_id: "cabinet", nm_id: 1, advert_id: 1, spent: 500 }, { cabinet_id: "cabinet", nm_id: 1, advert_id: 2, spent: 500 }],
    wb_adverts: [
      { advert_id: 1, name: "Поиск A", bid_type: "manual", payment_type: "cpc", placement_search: true, placement_shelf: false },
      { advert_id: 2, name: "Поиск B", bid_type: "manual", payment_type: "cpm", placement_search: true, placement_shelf: false },
    ],
  });
  const resolution = await resolveCtrSearchCampaign(db as never, "cabinet", 1);
  assert.equal(resolution.status, "ambiguous");
  assert.equal(resolution.advertId, null);
  assert.equal(resolution.candidates.length, 2);
});

test("привязка кампании — no-op, если у теста уже был раунд", async () => {
  const db = fakeDb({});
  const result = await ensureCtrTestCampaignBinding(db as never, {
    id: 1, cabinetId: "c", nmId: 1, testType: "ctr", roundNum: 2, advertId: null, shelfConflictState: "unchecked",
  });
  assert.equal(result.advertId, null);
  assert.equal(db.calls.length, 0, "тест с открытым раундом не должен резолвиться заново — знаменатель метрики нельзя менять посреди теста");
});

test("привязка кампании — no-op для не-ctr типов теста", async () => {
  const db = fakeDb({});
  await ensureCtrTestCampaignBinding(db as never, {
    id: 1, cabinetId: "c", nmId: 1, testType: "cr", roundNum: 0, advertId: null, shelfConflictState: "unchecked",
  });
  assert.equal(db.calls.length, 0);
});

test("привязка кампании не перезаписывает уже принятое решение человека по полкам", async () => {
  const db = fakeDb({
    wb_advert_nm_campaign_daily: [],
    wb_adverts: [{ advert_id: 9, cabinet_id: "c", name: "Полка", bid_type: "manual", payment_type: "cpc", placement_search: false, placement_shelf: true, status: 9, nm_ids: [1] }],
  });
  await ensureCtrTestCampaignBinding(db as never, {
    id: 1, cabinetId: "c", nmId: 1, testType: "ctr", roundNum: 0, advertId: null, shelfConflictState: "declined",
  });
  const update = db.calls.find((call) => call.table === "ctr_tests" && call.op === "update");
  assert.ok(update, "advert_id всё равно резолвится");
  assert.ok(
    !Object.prototype.hasOwnProperty.call(update!.payload as object, "shelf_conflict_state"),
    "осознанный отказ человека от паузы не должен затираться повторным резолвом на том же первом start",
  );
});

test("детект полок фильтрует по активному статусу и полочным блокам", async () => {
  const db = fakeDb({
    wb_adverts: [
      { advert_id: 1, cabinet_id: "cabinet", nm_ids: [1], name: "Активная полка", bid_type: "manual", payment_type: "cpc", placement_search: false, placement_shelf: true, status: 9 },
      { advert_id: 2, cabinet_id: "cabinet", nm_ids: [1], name: "Полка на паузе", bid_type: "manual", payment_type: "cpc", placement_search: false, placement_shelf: true, status: 11 },
    ],
  });
  const candidates = await findCompetingShelfCampaigns(db as never, "cabinet", 1, null);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].advertId, 1);
});

test("детект полок исключает саму привязанную поисковую кампанию", async () => {
  const db = fakeDb({
    wb_adverts: [
      { advert_id: 1, cabinet_id: "cabinet", nm_ids: [1], name: "Поиск+полки", bid_type: "manual", payment_type: "cpc", placement_search: true, placement_shelf: true, status: 9 },
    ],
  });
  const candidates = await findCompetingShelfCampaigns(db as never, "cabinet", 1, 1);
  assert.equal(candidates.length, 0);
});

test("гейт по полкам стоит у старта (ручного режима больше нет), а не у автономного тумблера", () => {
  const route = read("../app/api/ctrtest/[id]/action/route.ts");
  assert.doesNotMatch(route, /action === "auto"/, "отдельного тумблера auto больше нет — старт теперь сам его заменяет");
  const startBlock = route.slice(route.indexOf('if (action === "start") {'), route.indexOf("let snapshot"));
  assert.match(startBlock, /binding\.shelfConflictState/, "старт должен проверять состояние конфликта полок (из свежего результата резолюции, не устаревшего test.shelf_conflict_state)");
  assert.match(startBlock, /\["none", "confirmed", "declined"\]/);
  const advanceBlock = route.slice(route.indexOf('if (action === "advance")'), route.indexOf("// Резолюция поисковой кампании"));
  assert.doesNotMatch(advanceBlock, /shelfConflictState|shelf_conflict_state/, "ручная ротация легаси-тестов не должна блокироваться состоянием полок");
});

test("резолюция кампании вызывается из action route, только для test_type ctr", () => {
  const route = read("../app/api/ctrtest/[id]/action/route.ts");
  assert.match(route, /ensureCtrTestCampaignBinding\(db, \{/);
  assert.match(route, /getCtrMetricSnapshot\(cabinetId, nmId, binding\.advertId\)/);
});

test("автовозврат полок привязан к done/cancelled, не к паузе", () => {
  const action = read("../app/api/ctrtest/[id]/action/route.ts");
  assert.match(action, /resumeShelfPausesForTest/);
  assert.match(action, /status === "done" \|\| status === "cancelled"/);
  assert.doesNotMatch(
    action.slice(action.indexOf("outcome ="), action.indexOf("resumeShelfPausesForTest")),
    /cap_paused.*resumeShelfPausesForTest/s,
  );

  const rotate = read("../app/api/ctrtest/rotate/route.ts");
  assert.match(rotate, /resumeShelfPausesForTest/);
  assert.match(rotate, /status === "done" \|\| status === "cancelled"/);
});

test("shelf-conflicts POST требует роль director/wb_manager и не доверяет телу запроса", () => {
  const route = read("../app/api/ctrtest/[id]/shelf-conflicts/route.ts");
  assert.match(route, /requireApiSession\(\["director", "wb_manager"\]\)/);
  assert.doesNotMatch(route, /body\.candidates|body\?\.\s*candidates|body\.advertIds/, "кандидаты пересчитываются на сервере, не берутся из тела запроса");
  assert.match(route, /findCompetingShelfCampaigns\(db!, test!\.cabinet_id/);
});

test("пауза и возврат полок не идут self-HTTP-вызовом — только через setAdvertLifecycle", () => {
  const lib = read("../lib/ctrtest/campaignBinding.ts");
  assert.match(lib, /setAdvertLifecycle/);
  assert.doesNotMatch(lib, /fetch\(["'`]\/api\/adverts\/action/);
  const shelfRoute = read("../app/api/ctrtest/[id]/shelf-conflicts/route.ts");
  assert.doesNotMatch(shelfRoute, /fetch\(["'`]\/api\/adverts\/action/);
});

test("миграция объявляет колонки, constraint и таблицу пауз полок", () => {
  const migration = read("../supabase/migrations/202609150004_ctr_test_campaign_binding.sql");
  assert.match(migration, /add column if not exists advert_id bigint/);
  assert.match(migration, /shelf_conflict_state.*check \(shelf_conflict_state in \('unchecked', 'none', 'pending', 'confirmed', 'declined'\)\)/s);
  assert.match(migration, /create table if not exists public\.ctr_test_shelf_pauses/);
  assert.match(migration, /unique \(test_id, advert_id\)/);
});

test("новые select-колонки в маршрутах переживают 42703 (миграция ещё не применена)", () => {
  for (const path of ["../app/api/ctrtest/[id]/action/route.ts", "../app/api/ctrtest/rotate/route.ts", "../app/api/ctrtest/list/route.ts"]) {
    const source = read(path);
    assert.match(source, /42703/, `${path}: должен откатываться на старый список полей, если миграция ещё не применена`);
  }
});
