import { strict as assert } from "node:assert";
import test from "node:test";
import { normalizeCtrSnapshot, type CtrMetricSnapshot } from "../lib/ctrtest/model";
import {
  runStepTick,
  partialStepResult,
  type EngineStep,
  type EngineTest,
  type IoResult,
  type LiveRead,
  type StepIo,
  type StepPatch,
  type StepStore,
} from "../lib/ctrtest/stepEngine";
import { collectDecision, isStable, settleDecision, type StepDetail, type StepPhase, type StepReading } from "../lib/ctrtest/stepMachine";
import { MAX_FAIL_STREAK, buildVariantOrders, deriveRounds, normalizeVariantOrders, planStep, totalSteps } from "../lib/ctrtest/stepPlan";

/**
 * Новый движок CTR-тестов (владелец, 21.09.2026): сбой на любом этапе не
 * завершает и не пропускает шаг, а повторяет его. Каждая ветка ниже — про одно
 * из требований: смена фото → ожидание → показ до цели → статистика на паузе →
 * запись в историю.
 */

// ── План: раунды и порядок вариантов ─────────────────────────────────────────

test("число раундов считается из «показов на вариант» и «показов за шаг»", () => {
  assert.equal(deriveRounds(5000, 1000), 5);
  assert.equal(deriveRounds(4000, 1500), 3, "недобор округляется вверх: лучше лишний раунд, чем недокрут");
  assert.equal(deriveRounds(100, 1000), 1);
  assert.equal(deriveRounds(1_000_000, 10), 20, "потолок числа раундов");
  assert.equal(deriveRounds(0, 0), 1);
});

test("порядок по умолчанию — циклический сдвиг: каждый вариант побывает в каждой позиции", () => {
  assert.deepEqual(buildVariantOrders(3, 3), [[0, 1, 2], [1, 2, 0], [2, 0, 1]]);
  assert.deepEqual(buildVariantOrders(2, 3), [[0, 1], [1, 0], [0, 1]]);
});

test("свой порядок принимается, только если в каждом раунде все варианты ровно по разу", () => {
  const ok = normalizeVariantOrders([[0, 1, 2], [1, 0, 2], [0, 2, 1]], 3, 3);
  assert.deepEqual(ok, { ok: true, orders: [[0, 1, 2], [1, 0, 2], [0, 2, 1]] });
  assert.equal(normalizeVariantOrders(null, 3, 2).ok, true, "без порядка — сдвиг по умолчанию");
  assert.equal(normalizeVariantOrders([[0, 1, 2]], 3, 2).ok, false, "порядок нужен для каждого раунда");
  assert.equal(normalizeVariantOrders([[0, 1, 1], [0, 1, 2]], 3, 2).ok, false, "A-B-B недодал бы показов C");
  assert.equal(normalizeVariantOrders([[0, 1], [0, 1]], 3, 2).ok, false, "вариант выпал из раунда");
  assert.equal(normalizeVariantOrders([[0, 1, 3], [0, 1, 2]], 3, 2).ok, false, "позиции только от 0 до n−1");
});

test("место в плане считается по закрытым шагам: повтор шага плана не сдвигает", () => {
  const orders = [[11, 12, 13], [12, 11, 13]];
  assert.deepEqual(planStep(orders, 0), { passNo: 1, indexInPass: 0, variantId: 11 });
  assert.deepEqual(planStep(orders, 2), { passNo: 1, indexInPass: 2, variantId: 13 });
  assert.deepEqual(planStep(orders, 3), { passNo: 2, indexInPass: 0, variantId: 12 });
  assert.deepEqual(planStep(orders, 5), { passNo: 2, indexInPass: 2, variantId: 13 });
  assert.equal(planStep(orders, 6), null, "план выполнен");
  assert.equal(totalSteps(orders), 6);
});

// ── Автомат: остановка и устоявшаяся статистика ──────────────────────────────

const reading = (impressions: number, clicks = 0, spend = 0, at = "2026-09-22T10:00:00Z"): StepReading => ({ at, impressions, clicks, spend });

test("статистика устоялась, когда последние N опросов одинаковы", () => {
  assert.equal(isStable([reading(100), reading(100), reading(100)], 3), true);
  assert.equal(isStable([reading(100), reading(100)], 3), false, "опросов меньше N");
  assert.equal(isStable([reading(90), reading(100), reading(100)], 3), false);
  assert.equal(isStable([reading(100, 5), reading(100, 6), reading(100, 6)], 3), false, "клики тоже должны устояться");
  assert.equal(isStable([reading(100, 5, 10), reading(100, 5, 10.5), reading(100, 5, 10.5)], 3), false, "и расход");
  assert.equal(isStable([reading(1), reading(1), reading(100), reading(100), reading(100)], 3), true, "смотрим на хвост");
  assert.equal(isStable(undefined, 3), false);
});

test("не устоялась за отведённое время — не «закончено» и не «пропущено», решает человек", () => {
  const stoppedAt = "2026-09-22T10:00:00Z";
  const at = (min: number) => Date.parse(stoppedAt) + min * 60_000;
  assert.deepEqual(settleDecision({ reads: [reading(1), reading(2)], stableReads: 3, stoppedAt, now: at(20), settleMaxMin: 90 }), { status: "waiting" });
  assert.deepEqual(settleDecision({ reads: [reading(1), reading(2)], stableReads: 3, stoppedAt, now: at(90), settleMaxMin: 90 }), { status: "timeout" });
  assert.deepEqual(settleDecision({ reads: [reading(5), reading(5), reading(5)], stableReads: 3, stoppedAt, now: at(200), settleMaxMin: 90 }), { status: "stable" }, "устоявшаяся статистика важнее срока");
});

test("шаг останавливается по цели или по времени, а недобор помечается", () => {
  const base = { baseline: { impressions: 1000 }, target: 500, collectStartedAt: "2026-09-22T10:00:00Z", maxStepMin: 180 };
  const at = (min: number) => Date.parse("2026-09-22T10:00:00Z") + min * 60_000;
  assert.deepEqual(collectDecision({ ...base, live: { impressions: 1200 }, now: at(30) }), { stop: false, impressions: 200 });
  assert.deepEqual(collectDecision({ ...base, live: { impressions: 1500 }, now: at(30) }), { stop: true, reason: "target", impressions: 500 });
  assert.deepEqual(collectDecision({ ...base, live: { impressions: 1200 }, now: at(180) }), { stop: true, reason: "timeout", impressions: 200 });
  assert.equal(collectDecision({ ...base, live: { impressions: 900 }, now: at(30) }).impressions, 0, "счётчик откатился — считаем ноль, не минус");
});

// ── Движок: стенд без сети и базы ────────────────────────────────────────────

const T0 = Date.parse("2026-09-22T10:00:00Z");
const MIN = 60_000;

const snap = (impressions: number, clicks: number, spend: number): CtrMetricSnapshot =>
  normalizeCtrSnapshot({ impressions, clicks, spend, opens: 0, carts: 0, orders: 0, capturedAt: new Date(T0).toISOString() });

function baseTest(over: Partial<EngineTest> = {}): EngineTest {
  return {
    id: 1, cabinet_id: "cab", nm_id: 755558108, advert_id: 999,
    impressions_per_round: 1000, dead_zone_min: 5, max_step_min: 180, settle_max_min: 90, settle_stable_reads: 3,
    variant_orders: [[11, 12], [12, 11]],
    ...over,
  };
}

function harness(opts: { test?: Partial<EngineTest>; phase?: StepPhase | null; detail?: StepDetail; baseline?: CtrMetricSnapshot; closed?: number; urls?: [number, string][] } = {}) {
  const clock = { now: T0 };
  const script = {
    live: (): LiveRead => ({ ok: true, snapshot: snap(0, 0, 0) }),
    swap: (): IoResult => ({ ok: true }),
    start: (): IoResult => ({ ok: true }),
    pause: (): IoResult => ({ ok: true }),
    closeStatus: "running",
    closeError: null as string | null,
  };
  const calls: string[] = [];
  const state = {
    step: { id: "s1", variant_id: 11, pass_no: 1 as number | null, phase: (opts.phase === undefined ? null : opts.phase) as StepPhase | null, baseline: (opts.baseline ?? null) as Partial<CtrMetricSnapshot> | null, detail: (opts.detail ?? {}) as StepDetail | null },
    closed: opts.closed ?? 0,
    closes: [] as Parameters<StepStore["closeStep"]>[0][],
    labels: [] as { phase: StepPhase; pass_no: number }[],
    paused: [] as string[],
    patches: [] as StepPatch[],
  };
  const io: StepIo = {
    now: () => clock.now,
    todayMsk: () => "2026-09-22",
    shiftDay: () => "2026-09-21",
    liveSnapshot: async () => script.live(),
    swapPhoto: async (_t, url) => { calls.push(`swap:${url}`); return script.swap(); },
    startCampaign: async () => { calls.push("start"); return script.start(); },
    pauseCampaign: async () => { calls.push("pause"); return script.pause(); },
  };
  const store: StepStore = {
    variantUrls: async () => new Map(opts.urls ?? [[11, "https://ref.supabase.co/storage/v1/object/public/factory-media/ctr-pinned/a.webp"], [12, "https://ref.supabase.co/storage/v1/object/public/factory-media/ctr-pinned/b.webp"]]),
    closedSteps: async () => state.closed,
    patchStep: async (_id, patch) => {
      state.patches.push(patch);
      if (patch.phase) state.step.phase = patch.phase;
      if (patch.baseline) state.step.baseline = patch.baseline;
      if (patch.detail) state.step.detail = patch.detail;
    },
    closeStep: async (input) => {
      if (script.closeError) throw new Error(script.closeError);
      state.closes.push(input);
      state.closed += 1;
      return { status: script.closeStatus };
    },
    labelOpenedStep: async (_id, patch) => { state.labels.push({ phase: patch.phase, pass_no: patch.pass_no }); },
    pauseTest: async (_id, reason) => { state.paused.push(reason); },
  };
  const engineTest = baseTest(opts.test);
  const tick = (advanceMin = 0) => {
    clock.now += advanceMin * MIN;
    return runStepTick(engineTest, { ...state.step } as EngineStep, io, store);
  };
  return { clock, script, calls, state, tick };
}

test("шаг проходит всю цепочку: фото → реклама → прогрев → набор → пауза → устоявшаяся статистика → запись", async () => {
  const h = harness();

  // 1. Фото и реклама подряд за один проход, дальше ждём прогрев.
  let result = await h.tick();
  assert.match(result.note, /фото сменено.*реклама запущена.*прогрев/);
  assert.deepEqual(h.calls, ["swap:https://ref.supabase.co/storage/v1/object/public/factory-media/ctr-pinned/a.webp", "start"]);
  assert.equal(h.state.step.phase, "warmup");

  // 2. Прогрев идёт: ничего не считаем.
  result = await h.tick(3);
  assert.match(result.note, /прогрев/);
  assert.equal(h.state.step.phase, "warmup");

  // 3. Прогрев окончен: начало замера — показания в этот момент, а не в момент смены фото.
  h.script.live = () => ({ ok: true, snapshot: snap(1000, 20, 100) });
  result = await h.tick(3);
  assert.equal(h.state.step.phase, "collecting");
  assert.equal(h.state.step.baseline?.impressions, 1000);

  // 4. Цель ещё не набрана: реклама продолжает идти.
  h.script.live = () => ({ ok: true, snapshot: snap(1400, 28, 140) });
  result = await h.tick(5);
  assert.match(result.note, /набрано 400 из 1000/);
  assert.equal(h.calls.includes("pause"), false);

  // 5. Цель набрана: реклама на паузу, журнал опросов начинается пустым.
  h.script.live = () => ({ ok: true, snapshot: snap(2050, 45, 205) });
  result = await h.tick(5);
  assert.match(result.note, /цель набрана/);
  assert.equal(h.calls.at(-1), "pause");
  assert.equal(h.state.step.phase, "settling");
  assert.equal(h.state.step.detail?.stopReason, "target");
  assert.equal(h.state.step.detail?.stopSnapshot?.impressions, 2050);
  assert.deepEqual(h.state.step.detail?.reads, []);

  // 6. Цифры ещё доезжают (лаг WB): шаг не закрывается.
  h.script.live = () => ({ ok: true, snapshot: snap(2100, 47, 210) });
  result = await h.tick(5);
  assert.match(result.note, /ждём устоявшуюся/);
  assert.equal(h.state.closes.length, 0);
  result = await h.tick(5);
  assert.equal(h.state.closes.length, 0, "два одинаковых опроса из трёх — рано");

  // 7. Третий одинаковый опрос: статистика устоялась, шаг записан и открыт следующий вариант раунда.
  result = await h.tick(5);
  assert.equal(h.state.closes.length, 1);
  const close = h.state.closes[0];
  assert.equal(close.action, "advance");
  assert.equal(close.variantId, 12, "следующий по плану — вариант B");
  assert.equal(close.result.impressions, 1100, "результат — «после стабилизации» минус «при старте», а не «на стопе»");
  assert.equal(close.result.clicks, 27);
  assert.deepEqual(h.state.labels, [{ phase: "swap", pass_no: 1 }]);
  assert.equal(h.state.step.detail?.finalSnapshot?.impressions, 2100);
});

test("не сменилось фото — шаг не идёт дальше и повторяется, ничего не пропускается", async () => {
  const h = harness();
  h.script.swap = () => ({ ok: false, error: "WB 500" });
  let result = await h.tick();
  assert.match(result.error ?? "", /фото не сменилось: WB 500/);
  assert.equal(h.state.step.phase ?? "swap", "swap", "шаг остался на смене фото");
  assert.equal(h.calls.includes("start"), false, "реклама не запускалась на старом фото");
  assert.equal(h.state.closes.length, 0);
  assert.equal(h.state.paused.length, 0, "одиночный сбой тест на паузу не ставит");
  assert.equal(h.state.step.detail?.failStreak, 1);

  h.script.swap = () => ({ ok: true });
  result = await h.tick(5);
  assert.equal(result.error, null);
  assert.equal(h.state.step.phase, "warmup", "повтор прошёл, цепочка пошла дальше");
  assert.equal(h.state.step.detail?.failStreak, 0, "счётчик сбоев обнуляется после удачи");
});

test("реклама не запустилась — шаг остаётся на запуске и повторяется", async () => {
  const h = harness({ phase: "starting" });
  h.script.start = () => ({ ok: false, error: "кампания в статусе 8" });
  const result = await h.tick();
  assert.match(result.error ?? "", /реклама не запустилась/);
  assert.equal(h.state.step.phase, "starting");
  assert.equal(h.state.step.detail?.warmupUntil, undefined, "прогрев не начался: рекламы нет");
  h.script.start = () => ({ ok: true });
  await h.tick(5);
  assert.equal(h.state.step.phase, "warmup");
});

test("реклама не остановилась на цели — шаг остаётся в наборе, журнал стопа не пишется", async () => {
  const h = harness({ phase: "collecting", baseline: snap(1000, 10, 50), detail: { collectStartedAt: new Date(T0).toISOString(), rangeFrom: "2026-09-21" } });
  h.script.live = () => ({ ok: true, snapshot: snap(2100, 30, 100) });
  h.script.pause = () => ({ ok: false, error: "WB 429" });
  const result = await h.tick(5);
  assert.match(result.error ?? "", /реклама не остановилась/);
  assert.equal(h.state.step.phase, "collecting");
  assert.equal(h.state.step.detail?.stopSnapshot, undefined);
});

test("одинаковый сбой несколько проходов подряд ставит тест на паузу, шаг не засчитан", async () => {
  const h = harness();
  h.script.swap = () => ({ ok: false, error: "WB 500" });
  let last = await h.tick();
  for (let i = 1; i < MAX_FAIL_STREAK; i++) last = await h.tick(5);
  assert.equal(h.state.paused.length, 1);
  assert.match(h.state.paused[0], /фото не сменилось/);
  assert.equal(last.testStatus, "paused");
  assert.equal(h.state.closes.length, 0, "шаг не закрыт и не пропущен");
});

test("вариант с живой ссылкой на обложку — сразу пауза, в карточку он не пишется", async () => {
  const h = harness({ urls: [[11, "https://basket-35.wbbasket.ru/vol7555/part755558/755558108/images/big/1.webp"]] });
  const result = await h.tick();
  assert.equal(result.testStatus, "paused");
  assert.equal(h.calls.length, 0, "ни смены фото, ни запуска рекламы");
});

test("тест без кампании не работает: управлять нечем", async () => {
  const h = harness({ test: { advert_id: null } });
  const result = await h.tick();
  assert.equal(result.testStatus, "paused");
  assert.equal(h.calls.length, 0);
});

test("лимит WB на чтении статистики — это ожидание, а не сбой", async () => {
  const h = harness({ phase: "collecting", baseline: snap(0, 0, 0), detail: { collectStartedAt: new Date(T0).toISOString(), rangeFrom: "2026-09-21" } });
  h.script.live = () => ({ ok: false, error: "WB 429", rateLimited: true });
  for (let i = 0; i < MAX_FAIL_STREAK + 2; i++) {
    const result = await h.tick(5);
    assert.equal(result.error, null);
  }
  assert.equal(h.state.paused.length, 0, "лимит не копится в счётчик сбоев");
});

test("не набрали цель за отведённое время — стоп с пометкой «timeout»", async () => {
  const h = harness({ phase: "collecting", baseline: snap(1000, 10, 50), detail: { collectStartedAt: new Date(T0).toISOString(), rangeFrom: "2026-09-21" } });
  h.script.live = () => ({ ok: true, snapshot: snap(1300, 12, 60) });
  const result = await h.tick(181);
  assert.match(result.note, /время шага вышло/);
  assert.equal(h.state.step.phase, "settling");
  assert.equal(h.state.step.detail?.stopReason, "timeout");
  assert.equal(h.calls.at(-1), "pause");
});

test("статистика не устоялась за отведённое время — тест на паузе, шаг не засчитан", async () => {
  const stoppedAt = new Date(T0).toISOString();
  const h = harness({ phase: "settling", baseline: snap(1000, 10, 50), detail: { stoppedAt, rangeFrom: "2026-09-21", reads: [] } });
  let n = 2000;
  h.script.live = () => ({ ok: true, snapshot: snap(n += 10, 30, 100) });
  let result = await h.tick(30);
  assert.match(result.note, /ждём устоявшуюся/);
  result = await h.tick(70);
  assert.equal(result.testStatus, "paused");
  assert.match(h.state.paused[0], /не устоялась за 90 мин: шаг не засчитан/);
  assert.equal(h.state.closes.length, 0);
});

test("последний шаг плана закрывает тест, а не открывает следующий", async () => {
  const h = harness({ phase: "settling", baseline: snap(1000, 10, 50), closed: 3, detail: { stoppedAt: new Date(T0).toISOString(), rangeFrom: "2026-09-21", reads: [reading(2000, 30, 100), reading(2000, 30, 100)] } });
  h.script.live = () => ({ ok: true, snapshot: snap(2000, 30, 100) });
  h.script.closeStatus = "done";
  const result = await h.tick(5);
  assert.equal(h.state.closes[0].action, "finish");
  assert.equal(h.state.closes[0].variantId, null);
  assert.equal(result.testStatus, "done");
  assert.equal(h.state.labels.length, 0);
});

test("потолок расхода на закрытии шага: тест на паузе, следующий шаг не открыт", async () => {
  const h = harness({ phase: "settling", baseline: snap(1000, 10, 50), detail: { stoppedAt: new Date(T0).toISOString(), rangeFrom: "2026-09-21", reads: [reading(2000, 30, 100), reading(2000, 30, 100)] } });
  h.script.live = () => ({ ok: true, snapshot: snap(2000, 30, 100) });
  h.script.closeStatus = "paused";
  const result = await h.tick(5);
  assert.equal(result.testStatus, "paused");
  assert.equal(h.state.labels.length, 0);
});

test("база отказала при записи шага — данные не потеряны, шаг закроется на следующем проходе", async () => {
  const h = harness({ phase: "settling", baseline: snap(1000, 10, 50), detail: { stoppedAt: new Date(T0).toISOString(), rangeFrom: "2026-09-21", reads: [reading(2000, 30, 100), reading(2000, 30, 100)] } });
  h.script.live = () => ({ ok: true, snapshot: snap(2000, 30, 100) });
  h.script.closeError = "connection reset";
  let result = await h.tick(5);
  assert.match(result.error ?? "", /шаг не записан в историю/);
  assert.equal(h.state.step.detail?.finalSnapshot?.impressions, 2000, "устоявшиеся цифры уже лежат в журнале шага");
  assert.equal(h.state.closes.length, 0);

  h.script.closeError = null;
  result = await h.tick(5);
  assert.equal(result.error, null);
  assert.equal(h.state.closes.length, 1);
});

test("порядок вариантов по раундам: во втором раунде первым идёт другой вариант", async () => {
  // Закрыто 2 шага — это конец первого раунда, следующий шаг — первый во втором.
  const h = harness({ phase: "settling", closed: 1, baseline: snap(1000, 10, 50), detail: { stoppedAt: new Date(T0).toISOString(), rangeFrom: "2026-09-21", reads: [reading(2000, 30, 100), reading(2000, 30, 100)] } });
  h.script.live = () => ({ ok: true, snapshot: snap(2000, 30, 100) });
  await h.tick(5);
  assert.equal(h.state.closes[0].variantId, 12, "второй раунд начинается с варианта B: [12, 11]");
  assert.deepEqual(h.state.labels, [{ phase: "swap", pass_no: 2 }]);
});

// ── Досрочное закрытие человеком ─────────────────────────────────────────────

test("досрочное закрытие берёт цифры из журнала шага, а не из базы другой шкалы", () => {
  const baseline = snap(1000, 10, 50);
  const step = (phase: StepPhase | null, detail: StepDetail): EngineStep => ({ id: "s", variant_id: 11, pass_no: 1, phase, baseline, detail });
  const collecting = partialStepResult(step("collecting", { lastRead: reading(1400, 18, 70) }));
  assert.equal(collecting.impressions, 400);
  assert.equal(collecting.clicks, 8);
  const settling = partialStepResult(step("settling", { reads: [reading(1600, 20, 80)], lastRead: reading(1500, 19, 75) }));
  assert.equal(settling.impressions, 600, "берётся последнее показание после паузы");
  const warmup = partialStepResult(step("warmup", { lastRead: reading(1400, 18, 70) }));
  assert.equal(warmup.impressions, 0, "до начала замера показов у шага нет");
});
