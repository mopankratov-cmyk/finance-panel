import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CtrOrderEditor } from "../components/wb/ctr/CtrOrderEditor";
import { CtrRoundHistory } from "../components/wb/ctr/CtrRoundHistory";
import { CtrTestDetail } from "../components/wb/ctr/CtrTestDetail";
import { CtrTestWizard } from "../components/wb/ctr/CtrTestWizard";
import type { CtrRoundView, CtrTestView, CtrVariantView } from "../components/wb/ctr/types";
import { buildCtrMatrix, buildStepHistory, ctrOf, type HistoryInput } from "../lib/ctrtest/roundHistory";
import { moveInOrder, ordersFit } from "../lib/ctrtest/stepPlan";
import { ctrTestForecast } from "../lib/ctrtest/model";
import { adDowntimeHours, buildCreateBody, type WizardState } from "../lib/ctrtest/wizardPayload";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/**
 * Экран нового движка: три замера шага, CTR по раундам, порядок вариантов и
 * параметры мастера. Каждое число на экране считается чистой функцией и
 * проверяется здесь, а не глазами.
 */

// ── Данные ────────────────────────────────────────────────────────────────────

const variants = [
  { id: 11, label: "Вариант A", position: 0 },
  { id: 12, label: "Вариант B", position: 1 },
];

const snap = (impressions: number, clicks: number) => ({ impressions, clicks, spend: 0, opens: 0, carts: 0, orders: 0, capturedAt: "2026-09-22T10:00:00Z" });

/** Закрытый шаг: старт 1000/20 → стоп 2050/45 → после стабилизации 2100/47, итог 1100/27. */
const closedStep = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "r1", test_id: 7, variant_id: 11, round_number: 1, status: "closed", pass_no: 1, phase: "settling",
  close_reason: "advance", actor: "ctr-rotate", started_at: "2026-09-22T10:00:00Z", ended_at: "2026-09-22T12:00:00Z",
  baseline: snap(1000, 20), result: { impressions: 1100, clicks: 27 },
  detail: { stopSnapshot: snap(2050, 45), finalSnapshot: snap(2100, 47), stopReason: "target", attempts: 0 },
  ...over,
});

const input = (rounds: Record<string, unknown>[], extra: Partial<HistoryInput> = {}): HistoryInput => ({
  rounds: rounds as unknown as HistoryInput["rounds"], variants, impressionsPerStep: 1000, variantOrders: [[11, 12], [12, 11]], roundsTotal: 2, ...extra,
});

// ── История шагов: три замера ────────────────────────────────────────────────

test("шаг показывает три замера, итог и то, что WB донёс с задержкой", () => {
  const [step] = buildStepHistory(input([closedStep()]));
  assert.deepEqual(step.start, { impressions: 1000, clicks: 20 }, "при старте");
  assert.deepEqual(step.stop, { impressions: 2050, clicks: 45 }, "при стопе");
  assert.deepEqual(step.final, { impressions: 2100, clicks: 47 }, "после стабилизации");
  assert.deepEqual(step.lagged, { impressions: 50, clicks: 2 }, "разница между стопом и стабилизацией — лаг WB");
  assert.equal(step.result?.impressions, 1100, "итог = после стабилизации − старт, а не на стопе");
  assert.equal(step.result?.clicks, 27);
  assert.equal(step.result?.ctr, (27 / 1100) * 100);
  assert.equal(step.finalProvisional, false);
  assert.equal(step.short, false);
  assert.equal(step.letter, "A");
});

test("недобор помечается по времени шага и по объёму", () => {
  const timeout = buildStepHistory(input([closedStep({ detail: { stopSnapshot: snap(1500, 25), finalSnapshot: snap(1500, 25), stopReason: "timeout" } })]));
  assert.equal(timeout[0].short, true, "вышло время шага");
  const small = buildStepHistory(input([closedStep({ result: { impressions: 800, clicks: 12 } })]));
  assert.equal(small[0].short, true, "набрали меньше цели в 1000");
  const over = buildStepHistory(input([closedStep({ result: { impressions: 3819, clicks: 53 } })]));
  assert.equal(over[0].short, false, "перебор — не недобор");
});

test("идущий шаг: до замера «старта» нет, во время набора и ожидания — предварительные цифры", () => {
  const warmup = buildStepHistory(input([{ id: "a", variant_id: 11, round_number: 1, status: "active", pass_no: 1, phase: "warmup", baseline: snap(999999, 999), detail: {} }]))[0];
  assert.equal(warmup.start, null, "baseline до замера чужой — как «старт» не показывается");
  assert.equal(warmup.result, null);

  const collecting = buildStepHistory(input([{ id: "a", variant_id: 11, round_number: 1, status: "active", pass_no: 1, phase: "collecting", baseline: snap(1000, 20), detail: { lastRead: { at: "x", impressions: 1400, clicks: 28, spend: 0 } } }]))[0];
  assert.deepEqual(collecting.start, { impressions: 1000, clicks: 20 });
  assert.equal(collecting.result?.impressions, 400);
  assert.equal(collecting.resultProvisional, true);

  const settling = buildStepHistory(input([{ id: "a", variant_id: 11, round_number: 1, status: "active", pass_no: 1, phase: "settling", baseline: snap(1000, 20), detail: { stopSnapshot: snap(2050, 45), lastRead: { at: "x", impressions: 2080, clicks: 46, spend: 0 } } }]))[0];
  assert.deepEqual(settling.final, { impressions: 2080, clicks: 46 });
  assert.equal(settling.finalProvisional, true, "устоявшихся цифр ещё нет — последний опрос помечен как предварительный");
  assert.equal(settling.result?.impressions, 1080);
  assert.deepEqual(settling.lagged, { impressions: 30, clicks: 1 });
});

test("отменённые шаги в историю не входят, шаги идут по порядку выполнения", () => {
  const rows = buildStepHistory(input([
    closedStep({ id: "b", round_number: 2, variant_id: 12 }),
    closedStep({ id: "x", round_number: 3, status: "cancelled" }),
    closedStep({ id: "a", round_number: 1 }),
  ]));
  assert.deepEqual(rows.map((row) => row.id), ["a", "b"]);
});

test("повторы и последняя ошибка шага видны", () => {
  const [step] = buildStepHistory(input([{ id: "a", variant_id: 11, round_number: 1, status: "active", pass_no: 1, phase: "swap", baseline: {}, detail: { attempts: 3, lastError: "фото не сменилось: WB 500" } }]));
  assert.equal(step.attempts, 3);
  assert.equal(step.lastError, "фото не сменилось: WB 500");
});

// ── CTR по раундам ───────────────────────────────────────────────────────────

const round = (pass: number, variant: number, impressions: number, clicks: number, n: number) =>
  closedStep({ id: `r${n}`, round_number: n, pass_no: pass, variant_id: variant, result: { impressions, clicks } });

test("итоговый CTR — сумма кликов на сумму показов, а не среднее процентов", () => {
  const matrix = buildCtrMatrix(input([
    round(1, 11, 1000, 30, 1), round(1, 12, 1000, 20, 2),
    round(2, 12, 100, 10, 3), round(2, 11, 4000, 40, 4),
  ]));
  const a = matrix.rows.find((row) => row.letter === "A")!;
  const b = matrix.rows.find((row) => row.letter === "B")!;
  assert.equal(a.total.impressions, 5000);
  assert.equal(a.total.clicks, 70);
  assert.equal(a.total.ctr, (70 / 5000) * 100, "1,4%: у второго раунда объём вчетверо больше, и он весит вчетверо");
  assert.equal(b.total.ctr, (30 / 1100) * 100);
  assert.notEqual(a.total.ctr, ((3 + 1) / 2), "не среднее (3% и 1%)");
});

test("CTR по раундам: свой у каждого раунда, лидер отмечен, порядок подписан", () => {
  const matrix = buildCtrMatrix(input([
    round(1, 11, 1000, 30, 1), round(1, 12, 1000, 20, 2),
    round(2, 12, 1000, 30, 3), round(2, 11, 1000, 15, 4),
  ]));
  assert.deepEqual(matrix.passes, [{ passNo: 1, order: "A → B" }, { passNo: 2, order: "B → A" }]);
  const [a, b] = matrix.rows;
  assert.deepEqual([a.cells[0]?.ctr, a.cells[1]?.ctr], [3, 1.5]);
  assert.deepEqual([b.cells[0]?.ctr, b.cells[1]?.ctr], [2, 3]);
  assert.deepEqual(matrix.leaderByPass, [11, 12], "в раунде 1 впереди A, в раунде 2 — B");
  assert.equal(matrix.leaderTotal, 12, "по сумме: B 50/2000 = 2,5%, A 45/2000 = 2,25%");
});

test("процент не рисуется, пока показов меньше порога, и лидера тогда нет", () => {
  assert.equal(ctrOf(49, 10), null);
  assert.equal(ctrOf(50, 10), 20);
  const matrix = buildCtrMatrix(input([round(1, 11, 30, 5, 1), round(1, 12, 1000, 20, 2)]));
  assert.equal(matrix.rows[0].cells[0]?.ctr, null);
  assert.equal(matrix.leaderByPass[0], null, "сравнивать нечем: у одного из двух процента нет");
});

test("раунды, которых ещё не было, — пустые ячейки, а не ноль", () => {
  const matrix = buildCtrMatrix(input([round(1, 11, 1000, 30, 1)], { roundsTotal: 3 }));
  assert.equal(matrix.passes.length, 3);
  assert.equal(matrix.rows[0].cells[1], null);
  assert.equal(matrix.rows[1].cells[0], null);
});

// ── Порядок вариантов ────────────────────────────────────────────────────────

test("вариант сдвигается вверх и вниз, крайние места держат", () => {
  assert.deepEqual(moveInOrder([0, 1, 2], 1, -1), [1, 0, 2]);
  assert.deepEqual(moveInOrder([0, 1, 2], 1, 1), [0, 2, 1]);
  const same = [0, 1, 2];
  assert.equal(moveInOrder(same, 0, -1), same, "выше первого места не поднять");
  assert.equal(moveInOrder(same, 2, 1), same);
  assert.deepEqual(same, [0, 1, 2], "исходный массив не мутируется");
});

test("расставленный руками порядок действует, только пока подходит к числу вариантов и раундов", () => {
  assert.equal(ordersFit([[0, 1, 2], [1, 0, 2]], 3, 2), true);
  assert.equal(ordersFit([[0, 1, 2]], 3, 2), false, "добавили раунд");
  assert.equal(ordersFit([[0, 1, 2], [1, 0, 2]], 4, 2), false, "добавили вариант");
  assert.equal(ordersFit([[0, 1, 1], [1, 0, 2]], 3, 2), false, "вариант дважды");
  assert.equal(ordersFit(null, 3, 2), false);
});

// ── Тело запроса мастера ─────────────────────────────────────────────────────

const wizard = (over: Partial<WizardState> = {}): WizardState => ({
  type: "ctr", cabinetId: "cab", nmId: 5, article: "HT-1", intervalMin: 60, impressionsPerRound: 1000, targetImpressions: 5000,
  spendCapRub: 10000, sourceTestId: null, campaignMode: "search_only", pickedAdvertId: 999,
  variants: [{ label: "A", imageUrl: "https://x/a", source: "link" }, { label: "B", imageUrl: "https://x/b", source: "link" }],
  roundsTotal: 3, maxStepMin: 180, warmupMin: 5, customOrders: null, ...over,
});

test("у CTR-теста цель варианта — показов на шаг × раундов, и параметры движка уходят на сервер", () => {
  const body = buildCreateBody(wizard());
  assert.equal(body.targetImpressions, 3000, "1000 на шаг × 3 раунда, а не устаревшее поле «на вариант»");
  assert.equal(body.roundsTotal, 3);
  assert.equal(body.maxStepMin, 180);
  assert.equal(body.warmupMin, 5);
  assert.equal("variantOrders" in body, false, "порядок не менялся — сервер поставит сдвиг");
  assert.equal(body.advertId, 999);
});

test("свой порядок уходит только пока подходит; устаревший отбрасывается", () => {
  const custom = buildCreateBody(wizard({ roundsTotal: 2, customOrders: [[1, 0], [0, 1]] }));
  assert.deepEqual(custom.variantOrders, [[1, 0], [0, 1]]);
  const stale = buildCreateBody(wizard({ roundsTotal: 3, customOrders: [[1, 0], [0, 1]] }));
  assert.equal("variantOrders" in stale, false, "раундов стало три, а порядок задан на два");
});

test("тесты CR и видео остаются на прежних полях", () => {
  const body = buildCreateBody(wizard({ type: "cr", targetImpressions: 4000, roundsTotal: 9, customOrders: [[0, 1]] }));
  assert.equal(body.targetImpressions, 4000);
  assert.equal("roundsTotal" in body, false);
  assert.equal("variantOrders" in body, false);
  assert.equal(body.advertId, null);
});

test("простой рекламы: не меньше 15 минут на каждый шаг", () => {
  assert.equal(adDowntimeHours(3, 5), 3.75);
  assert.equal(adDowntimeHours(2, 2), 1);
});

// ── Экран (серверный рендер) ─────────────────────────────────────────────────

const view = (over: Partial<CtrTestView> = {}): CtrTestView => ({
  id: 7, cabinetId: "cab", nmId: 5, article: "HT-1", name: "HT-1", status: "running", testType: "ctr", intervalMin: 60,
  impressionsPerRound: 1000, targetImpressions: 2000, spendCapRub: 10000, liveSwapEnabled: true, autoError: null, roundNum: 4,
  currentVariantId: 12, winnerVariantId: null, winnerExplanation: null, sourceTestId: null, advertId: 999, shelfConflictState: "none",
  campaignMode: "search_only", aiAnalysis: null, aiAnalysisGeneratedAt: null, engineVersion: 2, roundsTotal: 2, maxStepMin: 180,
  settleMaxMin: 90, settleStableReads: 3, variantOrders: [[11, 12], [12, 11]], campaignRestorePending: false, campaignRestoreError: null,
  originalCoverUrl: null, coverSwappedAt: null, coverRestoredAt: null,
  variants: variants.map((entry): CtrVariantView => ({ id: entry.id, position: entry.position, label: entry.label, imageUrl: "https://x/img.webp", source: "link", isBaseline: false, isWinner: false, impressions: 0, clicks: 0, spend: 0, opens: 0, carts: 0, orders: 0, roundsCount: 0, roundsWon: 0, score: null, resultPct: null })),
  rounds: [
    round(1, 11, 1100, 27, 1), round(1, 12, 1000, 20, 2),
    { id: "act", test_id: 7, variant_id: 12, round_number: 3, status: "active", baseline: snap(2000, 40), result: {}, close_reason: null, actor: null, started_at: "2026-09-22T10:00:00Z", ended_at: null, pass_no: 2, phase: "collecting", detail: { lastRead: { at: "x", impressions: 2300, clicks: 50, spend: 0 } } },
  ] as unknown as CtrRoundView[],
  history: [], currentLive: null, startedAt: null, finishedAt: null, createdBy: null, createdAt: "2026-09-22T09:00:00Z", updatedAt: "2026-09-22T09:00:00Z", ...over,
});

test("история нового движка рисует раунды, порядок и три замера", () => {
  const html = renderToStaticMarkup(createElement(CtrRoundHistory, { test: view() }));
  assert.match(html, /CTR по раундам/);
  assert.match(html, /Раунд 1/);
  assert.match(html, /A → B/, "порядок первого раунда");
  assert.match(html, /B → A/, "порядок второго");
  assert.match(html, /При старте/);
  assert.match(html, /При стопе/);
  assert.match(html, /После стабилизации/);
  assert.match(html, /Донесено позже/);
  assert.match(html, /набираем показы/, "фаза идущего шага");
  assert.match(html, /scroll-x/, "таблица едет вбок внутри блока, страница не ломается");
});

test("экран теста нового движка показывает раунд, шаг и новую историю; прежний — прежнюю таблицу", () => {
  const props = { busy: false, onBack: () => undefined, onAction: () => undefined, onFlywheel: () => undefined };
  const engine = renderToStaticMarkup(createElement(CtrTestDetail, { ...props, test: view() }));
  assert.match(engine, /Раунд/);
  assert.match(engine, /Показов на шаг/);
  assert.match(engine, /Максимум на шаг/);
  assert.match(engine, /История шагов/);
  assert.doesNotMatch(engine, /История раундов/);

  const legacy = renderToStaticMarkup(createElement(CtrTestDetail, { ...props, test: view({ engineVersion: 1, roundsTotal: null, variantOrders: null }) }));
  assert.match(legacy, /История раундов/);
  assert.doesNotMatch(legacy, /История шагов/);
});

test("редактор порядка: по кнопке на каждое место, крайние заблокированы", () => {
  const html = renderToStaticMarkup(createElement(CtrOrderEditor, { labels: ["Вариант A", "Вариант B"], orders: [[0, 1], [1, 0]], customized: false, onChange: () => undefined, onReset: () => undefined }));
  assert.match(html, /Раунд 1/);
  assert.match(html, /Раунд 2/);
  assert.equal((html.match(/aria-label="Поднять/g) ?? []).length, 4, "по кнопке «выше» на каждое из четырёх мест");
  assert.equal((html.match(/disabled=""/g) ?? []).length, 4, "первое место не поднять, последнее не опустить — в каждом раунде");
  assert.match(html, /по умолчанию/);
  const changed = renderToStaticMarkup(createElement(CtrOrderEditor, { labels: ["A", "B"], orders: [[1, 0]], customized: true, onChange: () => undefined, onReset: () => undefined }));
  assert.match(changed, /Вернуть сдвиг по умолчанию/);
});

test("мастер CTR-теста: шаги и раунды, максимум на шаг, прогрев, порядок; CR остаётся прежним", () => {
  const props = { cabinetId: "cab", candidates: [], days: 7, onClose: () => undefined, onCreated: () => undefined };
  const ctr = renderToStaticMarkup(createElement(CtrTestWizard, { ...props, type: "ctr" }));
  for (const text of ["Показов на шаг", "Раундов", "Максимум на шаг", "Прогрев после смены фото", "Порядок вариантов по раундам", "Шагов:"]) {
    assert.match(ctr, new RegExp(text), text);
  }
  assert.doesNotMatch(ctr, /Показов на вариант/, "цель варианта считается сама");
  assert.match(ctr, /реклама простоит не меньше/, "владелец видит цену остановок до запуска");

  const cr = renderToStaticMarkup(createElement(CtrTestWizard, { ...props, type: "cr" }));
  assert.match(cr, /Показов на вариант/);
  assert.match(cr, /Интервал, минут/);
  assert.doesNotMatch(cr, /Порядок вариантов по раундам/);
});

test("экран подключает новый компонент и не показывает пустых обещаний", () => {
  const detail = read("../components/wb/ctr/CtrTestDetail.tsx");
  assert.match(detail, /isEngine \? <CtrRoundHistory test=\{test\} \/>/);
  const wizard = read("../components/wb/ctr/CtrTestWizard.tsx");
  assert.match(wizard, /buildCreateBody\(/);
  assert.match(wizard, /disabled=\{busy \|\| !selected \|\| variants\.some\(\(variant\) => !variant\.imageUrl\.trim\(\)\) \|\| \(type === "ctr" && !roundsValid\)\}/);
});

test("подсказка прогноза называет поле, которое человек видит, а не устаревшее", () => {
  const weak = { targetImpressions: 300, variantCount: 2, ctrPercent: 4, viewsInWindow: null, windowDays: 7 };
  assert.match(ctrTestForecast(weak).text, /поднимите «показов на вариант»/, "у CR и видео поле прежнее");
  assert.match(ctrTestForecast({ ...weak, lever: "«показов на шаг» или «раундов»" }).text, /поднимите «показов на шаг» или «раундов»/);
});

test("плашка внизу карточки говорит правду про новый движок: и фото, и реклама", () => {
  const props = { busy: false, onBack: () => undefined, onAction: () => undefined, onFlywheel: () => undefined };
  const engine = renderToStaticMarkup(createElement(CtrTestDetail, { ...props, test: view() }));
  assert.match(engine, /ставит кампанию на паузу и ждёт, пока статистика устоится/);
  assert.match(engine, /обложка и кампания возвращаются в прежнее состояние/);
  const legacy = renderToStaticMarkup(createElement(CtrTestDetail, { ...props, test: view({ engineVersion: 1, roundsTotal: null, variantOrders: null }) }));
  assert.doesNotMatch(legacy, /ставит кампанию на паузу/, "у прежнего движка кампанию тест не трогает");
});
