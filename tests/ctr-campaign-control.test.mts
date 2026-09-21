import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { pauseCampaignForStep, restoreCampaignState, startCampaignForStep } from "../lib/ctrtest/campaignHold";
import { fetchCampaignNmTotals } from "../lib/ctrtest/liveMetrics";
import { normalizeCtrCreatePayload } from "../lib/ctrtest/model";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/**
 * Кампания принадлежит владельцу, а не тесту: тест ведёт её между «идёт» и
 * «пауза» на время замера и возвращает в состояние до теста. Проверяется без
 * сети: WB и база подменены.
 */

// ── Стенд: WB и база ─────────────────────────────────────────────────────────

interface Wb { status: number | null; lifecycleFails: boolean; calls: string[] }

async function withWb<T>(wb: Wb, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/advert/v2/adverts") {
      wb.calls.push("status");
      return new Response(JSON.stringify({ adverts: wb.status == null ? [] : [{ id: 999, status: wb.status }] }), { status: 200 });
    }
    if (url.pathname === "/adv/v0/start" || url.pathname === "/adv/v0/pause") {
      const action = url.pathname.endsWith("start") ? "start" : "pause";
      wb.calls.push(action);
      if (wb.lifecycleFails) return new Response(JSON.stringify({ detail: "нельзя" }), { status: 400 });
      wb.status = action === "start" ? 9 : 11;
      return new Response("OK", { status: 200 });
    }
    return new Response("", { status: 404 });
  }) as typeof fetch;
  try { return await run(); } finally { globalThis.fetch = original; }
}

interface Call { table: string; op: string; payload?: Record<string, unknown> }
function fakeDb(row: Record<string, unknown> | null = null) {
  const calls: Call[] = [];
  class Query {
    call: Call;
    constructor(table: string) { this.call = { table, op: "select" }; }
    select() { return this; }
    update(payload: Record<string, unknown>) { this.call.op = "update"; this.call.payload = payload; return this; }
    insert(payload: Record<string, unknown>) { this.call.op = "insert"; this.call.payload = payload; return this; }
    eq() { return this; }
    maybeSingle() { return this.run(); }
    then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) { return this.run().then(resolve, reject); }
    run() { calls.push(this.call); return Promise.resolve({ data: this.call.op === "select" ? row : null, error: null }); }
  }
  return { db: { from: (table: string) => new Query(table) } as unknown as SupabaseClient, calls };
}

const TEST = { id: 13, cabinet_id: "cab", advert_id: 999 };

// ── Живая статистика ─────────────────────────────────────────────────────────

test("живая статистика суммируется по артикулу кампании и игнорирует чужие", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify([
    { advertId: 999, days: [
      { apps: [{ nms: [{ nmId: 755558108, views: 1000, clicks: 20, sum: 100 }, { nmId: 111, views: 5000, clicks: 500, sum: 900 }] }] },
      { apps: [{ nms: [{ nmId: 755558108, views: 500, clicks: 12, sum: 55.5 }] }, { nms: [{ nmId: 755558108, views: 100, clicks: 3, sum: 5 }] }] },
    ] },
    { advertId: 888, days: [{ apps: [{ nms: [{ nmId: 755558108, views: 9999, clicks: 999, sum: 999 }] }] }] },
  ]), { status: 200 })) as typeof fetch;
  try {
    const totals = await fetchCampaignNmTotals({ token: "t", advertId: 999, nmId: 755558108, from: "2026-09-21", to: "2026-09-22" });
    assert.deepEqual(totals, { ok: true, views: 1600, clicks: 35, spent: 160.5 });
  } finally { globalThis.fetch = original; }
});

test("лимит WB на статистике помечается как ожидание, а не как сбой", async () => {
  const original = globalThis.fetch;
  // Retry-After больше бюджета времени: повтор внутри вызова не делается, ответ возвращается сразу.
  globalThis.fetch = (async () => new Response("Too Many Requests", { status: 429, headers: { "retry-after": "600" } })) as typeof fetch;
  try {
    const totals = await fetchCampaignNmTotals({ token: "t", advertId: 999, nmId: 1, from: "2026-09-21", to: "2026-09-22" });
    assert.equal(totals.ok, false);
    assert.equal(!totals.ok && totals.rateLimited, true);
  } finally { globalThis.fetch = original; }
});

// ── Управление кампанией ─────────────────────────────────────────────────────

test("кампания уже идёт — запуск на шаг ничего не меняет у WB и не оставляет метку возврата", async () => {
  const wb: Wb = { status: 9, lifecycleFails: false, calls: [] };
  const { db, calls } = fakeDb();
  const result = await withWb(wb, () => startCampaignForStep(db, TEST, "t", "ctr-rotate"));
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(wb.calls, ["status"], "только чтение статуса, без команды");
  assert.equal(calls.length, 0, "ни аудита, ни метки: менять было нечего");
});

test("шаг набрал цель — кампания уходит на паузу, изменение записано в аудит и помечено к возврату", async () => {
  const wb: Wb = { status: 9, lifecycleFails: false, calls: [] };
  const { db, calls } = fakeDb();
  const result = await withWb(wb, () => pauseCampaignForStep(db, TEST, "t", "ctr-rotate"));
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(wb.calls, ["status", "pause"]);
  assert.equal(calls.find((call) => call.table === "wb_adverts")?.payload?.status, 11);
  const audit = calls.find((call) => call.table === "advert_bid_changes")?.payload;
  assert.equal(audit?.action, "ctr_step_pause");
  assert.equal(audit?.old_value, 9);
  assert.equal(audit?.new_value, 11);
  assert.equal(calls.find((call) => call.table === "ctr_tests")?.payload?.campaign_restore_pending, true, "тест теперь обязан вернуть кампанию");
});

test("новый шаг — кампания запускается из паузы", async () => {
  const wb: Wb = { status: 11, lifecycleFails: false, calls: [] };
  const { db } = fakeDb();
  assert.deepEqual(await withWb(wb, () => startCampaignForStep(db, TEST, "t", "ctr-rotate")), { ok: true });
  assert.deepEqual(wb.calls, ["status", "start"]);
});

test("кампания завершена или отклонена — тест её не трогает и говорит почему", async () => {
  const wb: Wb = { status: 7, lifecycleFails: false, calls: [] };
  const { db, calls } = fakeDb();
  const result = await withWb(wb, () => pauseCampaignForStep(db, TEST, "t", "ctr-rotate"));
  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.error : "", /не трогает/);
  assert.deepEqual(wb.calls, ["status"], "команда не отправлялась");
  assert.equal(calls.length, 0);
});

test("WB отказал в команде — ошибка вернулась, состояние в базе не менялось", async () => {
  const wb: Wb = { status: 9, lifecycleFails: true, calls: [] };
  const { db, calls } = fakeDb();
  const result = await withWb(wb, () => pauseCampaignForStep(db, TEST, "t", "ctr-rotate"));
  assert.equal(result.ok, false);
  assert.equal(calls.length, 0, "ни wb_adverts, ни аудита, ни метки: кампания осталась как была");
});

test("тест без привязанной кампании ничего не запускает", async () => {
  const wb: Wb = { status: 9, lifecycleFails: false, calls: [] };
  const { db } = fakeDb();
  const result = await withWb(wb, () => pauseCampaignForStep(db, { ...TEST, advert_id: null }, "t", "ctr-rotate"));
  assert.equal(result.ok, false);
  assert.equal(wb.calls.length, 0);
});

// ── Возврат кампании ─────────────────────────────────────────────────────────

test("возврат: кампания шла до теста, сейчас на паузе — запускается, метка снимается", async () => {
  const wb: Wb = { status: 11, lifecycleFails: false, calls: [] };
  const { db, calls } = fakeDb({ campaign_status_before: 9, campaign_restore_pending: true });
  const outcome = await withWb(wb, () => restoreCampaignState(db, TEST, "t", "ctr-rotate"));
  assert.deepEqual(outcome, { status: "restored" });
  assert.deepEqual(wb.calls, ["status", "start"]);
  const clear = calls.filter((call) => call.table === "ctr_tests" && call.op === "update").at(-1)?.payload;
  assert.equal(clear?.campaign_restore_pending, false);
  assert.equal(clear?.campaign_restore_error, null);
});

test("возврат: кампанию, что была на паузе ещё до теста, на паузе и оставляем", async () => {
  const wb: Wb = { status: 9, lifecycleFails: false, calls: [] };
  const { db } = fakeDb({ campaign_status_before: 11, campaign_restore_pending: true });
  const outcome = await withWb(wb, () => restoreCampaignState(db, TEST, "t", "ctr-rotate"));
  assert.deepEqual(outcome, { status: "restored" });
  assert.deepEqual(wb.calls, ["status", "pause"], "включать то, что владелец выключил сам, тест не вправе");
});

test("возврат: уже в нужном состоянии — команда не нужна, метка снимается", async () => {
  const wb: Wb = { status: 9, lifecycleFails: false, calls: [] };
  const { db } = fakeDb({ campaign_status_before: 9, campaign_restore_pending: true });
  assert.deepEqual(await withWb(wb, () => restoreCampaignState(db, TEST, "t", "ctr-rotate")), { status: "restored" });
  assert.deepEqual(wb.calls, ["status"]);
});

test("возврат: отказ WB не гасит очередь — метка остаётся, причина записана", async () => {
  const wb: Wb = { status: 11, lifecycleFails: true, calls: [] };
  const { db, calls } = fakeDb({ campaign_status_before: 9, campaign_restore_pending: true });
  const outcome = await withWb(wb, () => restoreCampaignState(db, TEST, "t", "ctr-rotate"));
  assert.equal(outcome.status, "failed");
  const writes = calls.filter((call) => call.table === "ctr_tests" && call.op === "update").map((call) => call.payload);
  assert.equal(writes.some((payload) => payload?.campaign_restore_pending === false), false, "метка возврата не снята");
  assert.ok(writes.some((payload) => typeof payload?.campaign_restore_error === "string"));
});

test("возврат: нечего возвращать, если тест кампанию не менял", async () => {
  const wb: Wb = { status: 9, lifecycleFails: false, calls: [] };
  const { db } = fakeDb({ campaign_status_before: 9, campaign_restore_pending: false });
  assert.deepEqual(await withWb(wb, () => restoreCampaignState(db, TEST, "t", "ctr-rotate")), { status: "skipped", reason: "nothing-pending" });
  assert.equal(wb.calls.length, 0);
});

// ── План теста в мастере ─────────────────────────────────────────────────────

const payload = (extra: Record<string, unknown> = {}) => ({
  cabinetId: "00000000-0000-4000-8000-000000000001", nmId: 123, testType: "ctr", intervalMin: 60,
  impressionsPerRound: 1000, targetImpressions: 5000, spendCapRub: 5000,
  variants: [{ imageUrl: "https://example.com/a.webp" }, { imageUrl: "https://example.com/b.webp" }, { imageUrl: "https://example.com/c.webp" }],
  ...extra,
});

test("число раундов берётся из прежних полей мастера, а порядок — циклический сдвиг", () => {
  const result = normalizeCtrCreatePayload(payload());
  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.roundsTotal, 5, "5000 показов на вариант при 1000 за шаг — пять раундов");
  assert.equal(result.value.maxStepMin, 180);
  assert.equal(result.value.warmupMin, 5);
  assert.deepEqual(result.value.variantOrders.slice(0, 3), [[0, 1, 2], [1, 2, 0], [2, 0, 1]]);
});

test("параметры раундов задаются явно и проверяются", () => {
  const custom = normalizeCtrCreatePayload(payload({ roundsTotal: 3, maxStepMin: 90, warmupMin: 10, variantOrders: [[0, 1, 2], [1, 0, 2], [0, 2, 1]] }));
  assert.ok(custom.ok);
  assert.deepEqual(custom.value.variantOrders, [[0, 1, 2], [1, 0, 2], [0, 2, 1]]);
  assert.equal(custom.value.roundsTotal, 3);
  assert.equal(custom.value.maxStepMin, 90);
  assert.equal(custom.value.warmupMin, 10);

  assert.equal(normalizeCtrCreatePayload(payload({ roundsTotal: 0 })).ok, false);
  assert.equal(normalizeCtrCreatePayload(payload({ roundsTotal: 21 })).ok, false);
  assert.equal(normalizeCtrCreatePayload(payload({ maxStepMin: 5 })).ok, false, "минимум 30 минут на шаг");
  assert.equal(normalizeCtrCreatePayload(payload({ warmupMin: 0 })).ok, false);
  assert.equal(normalizeCtrCreatePayload(payload({ roundsTotal: 2, variantOrders: [[0, 1, 2]] })).ok, false, "порядок нужен для каждого раунда");
  assert.equal(normalizeCtrCreatePayload(payload({ roundsTotal: 1, variantOrders: [[0, 0, 1]] })).ok, false, "вариант дважды в раунде");
});

// ── Порядок и границы в роутах ───────────────────────────────────────────────

test("крон ведёт новые тесты автоматом, а прежние — прежним путём", () => {
  const route = read("../app/api/ctrtest/rotate/route.ts");
  const engine = route.indexOf("runStepEngineTests(db, report, restoreAttempted)");
  const legacy = route.indexOf("for (const test of ((tests ?? []) as TestRow[])");
  assert.ok(engine > 0 && legacy > engine, "движок идёт до прежнего цикла");
  assert.match(route, /filter\(\(row\) => !engineIds\.has\(row\.id\)\)/, "тест нового движка не попадает в прежний цикл");

  const runner = read("../lib/ctrtest/stepRunner.ts");
  assert.match(runner, /\.eq\("engine_version", 2\)/);
  assert.match(runner, /\.eq\("campaign_restore_pending", true\)/, "очередь возврата кампаний не гаснет");
});

test("пауза и возобновление нового движка идут мимо SQL, а кампания возвращается при любом выходе", () => {
  const route = read("../app/api/ctrtest/[id]/action/route.ts");
  const pause = route.indexOf("pauseStepEngineTest(");
  const resume = route.indexOf("resumeStepEngineTest(");
  const rpc = route.indexOf('rpc("transition_ctr_test"');
  assert.ok(pause > 0 && resume > 0 && rpc > 0);
  assert.ok(pause < rpc && resume < rpc, "SQL-функция закрыла бы недоделанный шаг с неполными цифрами");
  assert.ok(route.indexOf("prepareStepEngineStart(") < route.indexOf("prepareTestForStart("), "кампания и план проверяются до копирования картинок");
  assert.ok((route.match(/restoreCampaignForTest\(/g) ?? []).length >= 2, "и после паузы, и после завершения");
  assert.match(route, /activeStepResult\(db, id\)/, "результат досрочного закрытия — по журналу шага");
  assert.match(route, /variantId: engineStartVariant \?\? body\?\.variantId \?\? null/, "старт начинается с первого варианта плана");
});

test("новый CTR-тест создаётся с планом или не создаётся вовсе", () => {
  const route = read("../app/api/ctrtest/list/route.ts");
  assert.ok(route.indexOf('select("engine_version")') < route.indexOf("needsPin(variant.imageUrl)"), "миграция проверяется до копирования картинок");
  assert.match(route, /engine_version: 2/);
  assert.match(route, /variant_orders: variantOrders/);
  assert.match(route, /target_impressions: normalized\.value\.impressionsPerRound \* normalized\.value\.roundsTotal/);
  assert.match(route, /delete\(\)\.eq\("id", id\)/, "черновик без плана не остаётся жить на прежнем движке");
});

test("миграция заводит все колонки движка", () => {
  const sql = read("../supabase/migrations/202609220001_ctr_test_step_engine.sql");
  for (const column of ["engine_version", "rounds_total", "max_step_min", "settle_max_min", "settle_stable_reads", "variant_orders", "campaign_status_before", "campaign_restore_pending", "campaign_restore_error", "pass_no", "phase", "phase_at", "detail"]) {
    assert.match(sql, new RegExp(`add column if not exists ${column}\\b`), column);
  }
  assert.doesNotMatch(sql, /create or replace function/, "SQL-функция перехода не меняется");
});
