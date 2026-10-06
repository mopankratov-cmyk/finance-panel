import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PhotoTraitsError } from "../components/assortment/PhotoTraits.tsx";
import { ReadinessStrip } from "../components/assortment/DataReadiness.tsx";
import { CATALOG_AI_JOB, pickCandidates, PROMPT_VERSION, stopTag, summarizeQueue, TRAITS_REPORT_VERSION, type CatalogHead, type ExistingResult, type PhotoTraitsReport } from "../lib/assortment/catalogAi.ts";
import { modelKey } from "../lib/assortment/modelKey.ts";
import { buildReadiness, type DemandFacts, type HistorySource, type ReadinessInput, type TraitsFacts } from "../lib/assortment/dataReadiness.ts";
import { loadReadiness } from "../lib/assortment/dataReadinessStore.ts";

/** «На чём стоят цифры»: что копится, с какого дня и когда функция станет честной (05.10). Даты — расчёт, не обещание. */

const root = fileURLToPath(new URL("..", import.meta.url));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const NOW = Date.parse("2026-10-06T10:00:00Z");
const traits = (over: Partial<TraitsFacts> = {}): TraitsFacts => ({
  enabled: true, keyConfigured: true, priced: true, model: "google/gemini-2.5-flash", analyzed: 62, legacy: 0, eligible: 1172, queued: 1110, exhausted: 0, unstable: 0, failed: 0, recentOk: 62, recentFailed: 0,
  lastOkAt: "2026-10-06T09:00:00Z", lastAttemptAt: "2026-10-06T09:00:00Z", otherQueued: 0, callsToday: 27, dailyLimit: 1500, weekUsd: 0.03, weeklyBudgetUsd: 20, budgetCallsLeft: 5000, lastErrors: [], ...over,
});
const input = (over: Partial<ReadinessInput> = {}): ReadinessInput => ({ today: "2026-10-06", nowMs: NOW, traits: traits(), demand: null, history: null, ...over });
const lines = (report: ReturnType<typeof buildReadiness>, key: string) => report.groups.find((g) => g.key === key)!.lines.map((l) => l.text).join(" | ");
const src = (name: string, status: HistorySource["status"], firstDay: string | null, firstFullDay: string | null = firstDay): HistorySource => ({ name, status, firstDay, firstFullDay });

test("Признаки по фото: разобрано N из M, вызовы и расход, срок очереди с вилкой по реальной скорости прогона", () => {
  const r = buildReadiness(input());
  const t = lines(r, "traits");
  assert.match(t, /Разобрано по фото 62 из 1\s172 моделей \(5,3%\)/);
  assert.match(t, /Сегодня вызовов 27 из 1\s500; за 7 дней потрачено \$0,03 из \$20,00/);
  assert.match(t, /Осталось разобрать 1\s110; при потолке 1\s440 в сутки \(прогон — 75–120 моделей, 12 прогонов\) на всё уйдёт от 1 до 2 суток/, "потолок 1500 упирается в 12 прогонов × 120; вилка 1 110/1 440 … 1 110/900");
  assert.equal(r.problem, false);
  assert.match(lines(buildReadiness(input({ traits: traits({ dailyLimit: 300 }) })), "traits"), /при потолке 300 в сутки .* около 4 суток/);
  assert.match(lines(buildReadiness(input({ traits: traits({ analyzed: 1172, queued: 0 }) })), "traits"), /Очередь разобрана/);
  const kinds = r.groups[0].lines.map((l) => l.kind);
  assert.ok(kinds.includes("факт") && kinds.includes("расчёт"), "каждая строка помечена: факт или расчёт");
});

test("Очередь общая для двух разделов: остаток другого раздела назван и входит в срок; бюджета недели меньше очереди — отдельная строка", () => {
  const r = buildReadiness(input({ traits: traits({ analyzed: 1000, eligible: 1172, queued: 172, otherQueued: 1400, budgetCallsLeft: 800 }) }));
  const t = lines(r, "traits");
  assert.match(t, /Осталось разобрать 172 \(в другом разделе ещё 1\s400: очередь у сборщика общая\)/);
  assert.match(t, /на всё уйдёт от 2 до 2 суток|на всё уйдёт около 2 суток|на всё уйдёт от 2 до 3 суток/);
  assert.match(t, /Остатка бюджета недели хватит примерно на 800 вызовов — меньше очереди \(1\s572\): разбор встанет раньше, чем она закончится\./);
  const fine = lines(buildReadiness(input({ traits: traits({ analyzed: 1000, queued: 172, otherQueued: 0, budgetCallsLeft: 5000 }) })), "traits");
  assert.doesNotMatch(fine, /Остатка бюджета/);
});

test("Остановки по настройке названы и раскрывают полоску: выключен, нет ключа, нет цены у модели, потолок 0, бюджет недели 0 и исчерпан; потолок суток — не проблема", () => {
  const cases: Array<[Partial<TraitsFacts>, RegExp]> = [
    [{ enabled: false }, /Сборщик стоит — выключен настройкой ASSORTMENT_CATALOG_AI=off/],
    [{ keyConfigured: false }, /Сборщик стоит — нет ключа ИИ/],
    [{ priced: false, model: "claude-unknown-9" }, /Сборщик стоит — нет цены модели: для модели «claude-unknown-9» нет цены в таблице/],
    [{ dailyLimit: 0 }, /Потолок суток 0: разбор остановлен/],
    [{ weeklyBudgetUsd: 0, budgetCallsLeft: null }, /Бюджет недели 0: разбор остановлен/],
    [{ weekUsd: 20.5 }, /Сборщик стоит — упёрся в бюджет недели/],
  ];
  for (const [over, re] of cases) {
    const r = buildReadiness(input({ traits: traits(over) }));
    assert.equal(r.problem, true, JSON.stringify(over));
    assert.match(lines(r, "traits"), re);
    assert.doesNotMatch(lines(r, "traits"), /на всё уйдёт/, "при остановке срока «около суток» нет");
  }
  assert.equal(buildReadiness(input({ traits: traits({ callsToday: 1500 }) })).problem, false, "потолок суток достигнут — это норма");
});

test("«Не движется»: условия рабочие, очередь есть, последняя модель разобрана больше суток назад — проблема; свежая — нет; при остановке по настройке не дублируется", () => {
  const stalled = buildReadiness(input({ traits: traits({ lastOkAt: "2026-10-04T08:00:00Z", lastAttemptAt: "2026-10-04T08:00:00Z", callsToday: 0 }) }));
  assert.equal(stalled.problem, true);
  assert.match(lines(stalled, "traits"), /Последняя модель разобрана 04\.10 в 11:00 МСК\./);
  assert.match(lines(stalled, "traits"), /Сборщик ничего не пробовал разобрать больше 24 часов \(последняя попытка 04\.10 в 11:00 МСК\) при непустой очереди — разбор не движется/);
  const fresh = buildReadiness(input());
  assert.match(lines(fresh, "traits"), /Последняя модель разобрана 06\.10 в 12:00 МСК\.$/m);
  assert.equal(fresh.problem, false);
  const done = buildReadiness(input({ traits: traits({ analyzed: 1172, queued: 0, lastOkAt: "2026-10-01T08:00:00Z", lastAttemptAt: "2026-10-01T08:00:00Z" }) }));
  assert.equal(done.problem, false, "очередь пуста — давнее «последняя» не тревога");
  const stopped = buildReadiness(input({ traits: traits({ enabled: false, lastOkAt: "2026-10-01T08:00:00Z", lastAttemptAt: "2026-10-01T08:00:00Z" }) }));
  assert.doesNotMatch(lines(stopped, "traits"), /не движется/);
});

test("Неразобранные: тревога по последним 7 суткам, а не по накопленному; мало попыток — не судим; причины названы", () => {
  const recentBad = buildReadiness(input({ traits: traits({ failed: 160, recentOk: 40, recentFailed: 40, lastErrors: [{ message: "HTTP 403: модерация", count: 30 }, { message: "фото не скачалось", count: 10 }] }) }));
  assert.equal(recentBad.problem, true);
  assert.match(lines(recentBad, "traits"), /Не разобралось 160 моделей \(повторяются до трёх попыток, дальше остаются неразобранными\): HTTP 403: модерация \(30\); фото не скачалось \(10\)\. За 7 суток неудачных 50% попыток/);
  const oldFailures = buildReadiness(input({ traits: traits({ failed: 160, recentOk: 300, recentFailed: 3 }) }));
  assert.equal(oldFailures.problem, false, "160 накопленных неудач при почти идеальной неделе — не «ложная тревога навсегда»");
  const fewTries = buildReadiness(input({ traits: traits({ failed: 3, recentOk: 5, recentFailed: 3 }) }));
  assert.equal(fewTries.problem, false, "8 попыток — судить рано");
  assert.match(lines(fewTries, "traits"), /Не разобралось 3 модели/);
});

test("Очередь — только то, что сборщик возьмёт: исчерпавшие попытки и нестабильный ключ в «осталось разобрать» не входят, сутки без новых моделей — не «разбор не движется»", () => {
  const t = traits({ analyzed: 4840, eligible: 5000, queued: 0, exhausted: 160, failed: 160, recentOk: 300, recentFailed: 3, lastOkAt: "2026-10-05T07:00:00Z", lastAttemptAt: "2026-10-05T07:00:00Z" });
  const r = buildReadiness(input({ traits: t }));
  const text = lines(r, "traits");
  assert.match(text, /Очередь разобрана/);
  assert.doesNotMatch(text, /Осталось разобрать|на всё уйдёт/);
  assert.match(text, /Ещё 160 моделей сборщик не возьмёт: 160 исчерпали три попытки\. В «осталось разобрать» они не входят\./);
  assert.doesNotMatch(text, /не движется/, "очередь пуста — сутки без новых моделей не тревога");
  assert.equal(r.problem, false);
  const mixed = lines(buildReadiness(input({ traits: traits({ queued: 40, exhausted: 5, unstable: 7, lastOkAt: "2026-10-06T09:00:00Z" }) })), "traits");
  assert.match(mixed, /Осталось разобрать 40;/);
  assert.match(mixed, /Ещё 12 моделей сборщик не возьмёт: 5 исчерпали три попытки; у 7 ключ модели в базе не совпал с расчётным \(ближайший обход его перепишет\)/);
  const stalledQueue = buildReadiness(input({ traits: traits({ queued: 40, lastOkAt: "2026-10-04T08:00:00Z", lastAttemptAt: "2026-10-04T08:00:00Z" }) }));
  assert.equal(stalledQueue.problem, true, "а когда очередь настоящая и ничего не разобрано сутки — тревога остаётся");
});

test("Очередь другого раздела не узнали (null): «очередь разобрана» не пишем, срок честно оговорён; ноль — только когда там действительно пусто", () => {
  const unknownEmpty = lines(buildReadiness(input({ traits: traits({ analyzed: 1172, queued: 0, otherQueued: null }) })), "traits");
  assert.doesNotMatch(unknownEmpty, /Очередь разобрана/);
  assert.match(unknownEmpty, /В этом разделе очередь пуста; очередь другого раздела не прочиталась — общий срок посчитать нельзя\./);
  const unknown = lines(buildReadiness(input({ traits: traits({ queued: 100, otherQueued: null }) })), "traits");
  assert.match(unknown, /Осталось разобрать 100 \(очередь другого раздела не прочиталась — срок без неё\)/);
  assert.match(lines(buildReadiness(input({ traits: traits({ analyzed: 1172, queued: 0, otherQueued: 0 }) })), "traits"), /Очередь разобрана/);
});

test("Сторож без единой удачи: следов попыток нет — «ещё не отработал» без тревоги; были вызовы или неудачи, а удач нет — проблема", () => {
  const quiet = buildReadiness(input({ traits: traits({ analyzed: 0, queued: 4000, recentOk: 0, lastOkAt: null, lastAttemptAt: null, callsToday: 0, weekUsd: 0 }) }));
  assert.match(lines(quiet, "traits"), /Ни одна модель ещё не разобрана и следов попыток нет: сборщик ещё не запускался или журнал крона не прочитался/);
  assert.equal(quiet.problem, false, "первые часы после выкладки — не красная тревога");
  for (const over of [{ callsToday: 5 }, { weekUsd: 0.4 }, { failed: 12, recentFailed: 12 }]) {
    const tried = buildReadiness(input({ traits: traits({ analyzed: 0, queued: 4000, recentOk: 0, lastOkAt: null, lastAttemptAt: null, callsToday: 0, weekUsd: 0, ...over }) }));
    assert.equal(tried.problem, true, JSON.stringify(over));
    assert.match(lines(tried, "traits"), /Ни одна модель не разобрана, хотя вызовы или неудачи были/);
  }
});

test("«Не движется» — по последней ПОПЫТКЕ: в очереди одни повторы внутри суточной паузы, сборщик жив (свежая неудача), удачи нет больше суток — не тревога; ни попыток, ни удач больше суток — тревога", () => {
  const retriesOnly = buildReadiness(input({ traits: traits({ queued: 3, failed: 3, recentOk: 300, recentFailed: 6, lastOkAt: "2026-10-05T04:00:00Z", lastAttemptAt: "2026-10-06T08:00:00Z" }) }));
  assert.equal(retriesOnly.problem, false, "последняя удача 30 часов назад, но попытка — 2 часа назад");
  assert.match(lines(retriesOnly, "traits"), /Последняя модель разобрана 05\.10 в 07:00 МСК\./);
  assert.doesNotMatch(lines(retriesOnly, "traits"), /не движется/);
  const silent = buildReadiness(input({ traits: traits({ queued: 3, lastOkAt: "2026-10-05T04:00:00Z", lastAttemptAt: "2026-10-05T04:00:00Z", callsToday: 0 }) }));
  assert.equal(silent.problem, true);
  assert.match(lines(silent, "traits"), /Сборщик ничего не пробовал разобрать больше 24 часов \(последняя попытка 05\.10 в 07:00 МСК\)/);
});

test("Вызовы сегодня есть, а записанных попыток больше суток нет: не «ничего не пробовал» (это ложь), а «вызовы идут, но ни одна модель не записана» — временные сбои пишутся пометкой, значит, остановка без записи или сбой записи", () => {
  const r = buildReadiness(input({ traits: traits({ queued: 50, callsToday: 36, lastOkAt: "2026-10-04T08:00:00Z", lastAttemptAt: "2026-10-04T08:00:00Z" }) }));
  const t = lines(r, "traits");
  assert.match(t, /Вызовы идут \(сегодня 36\), но ни одна модель не записана больше 24 часов \(последняя запись 04\.10 в 11:00 МСК\) при непустой очереди — ответы провайдера не доходят до записи \(остановка по ключу, деньгам или лимиту либо сбой записи в базу\)/);
  assert.doesNotMatch(t, /временные сбои/, "временные сбои теперь записываются пометкой в строку модели — на них не киваем");
  assert.doesNotMatch(t, /ничего не пробовал/);
  assert.equal(r.problem, true);
});

test("Нет вида каталога (миграция 202610050002): «0 из 0» и «Очередь разобрана» не пишем — очередь неизвестна, это проблема с названием миграции", () => {
  const r = buildReadiness(input({ traits: traits({ analyzed: 0, eligible: 0, queued: 0, catalogMissing: true, lastOkAt: null, lastAttemptAt: null }) }));
  const t = lines(r, "traits");
  assert.match(t, /Каталога для разбора ещё нет \(не применена миграция 202610050002\)/);
  assert.doesNotMatch(t, /Очередь разобрана/);
  assert.equal(r.problem, true);
});

test("«Ни одна модель не разобрана» — только когда разобранных нет вовсе: есть разобранные (в т.ч. по прежнему вопросу) или время не прочиталось — строки и тревоги нет", () => {
  const base = { lastOkAt: null, lastAttemptAt: null, callsToday: 5, weekUsd: 0.4, queued: 4000 };
  const analyzed = buildReadiness(input({ traits: traits({ ...base, analyzed: 62 }) }));
  assert.doesNotMatch(lines(analyzed, "traits"), /Ни одна модель/, "62 разобраны — «ни одной» было бы ложью (например, не прочитался запрос времени)");
  assert.equal(analyzed.problem, false);
  const legacyOnly = buildReadiness(input({ traits: traits({ ...base, analyzed: 0, legacy: 100, lastAttemptAt: "2026-10-06T08:00:00Z" }) }));
  assert.doesNotMatch(lines(legacyOnly, "traits"), /Ни одна модель/, "после смены вопроса все пересборы неудачны: разобранные есть, только прежние");
  const unread = buildReadiness(input({ traits: traits({ ...base, analyzed: 0, readFailed: true }) }));
  assert.doesNotMatch(lines(unread, "traits"), /Ни одна модель/, "время не прочиталось — «ни одной удачи» не заключаем");
  const real = buildReadiness(input({ traits: traits({ ...base, analyzed: 0, lastAttemptAt: "2026-10-06T08:00:00Z" }) }));
  assert.match(lines(real, "traits"), /Ни одна модель не разобрана, хотя вызовы или неудачи были/);
  assert.equal(real.problem, true);
});

test("Бюджет кончается раньше нуля: остатка не хватает на один вызов — это остановка, а не «разбор не движется (проверьте ключ)»", () => {
  const r = buildReadiness(input({ traits: traits({ weekUsd: 19.996, weeklyBudgetUsd: 20, budgetCallsLeft: 0, lastOkAt: "2026-10-05T08:00:00Z", lastAttemptAt: "2026-10-05T08:00:00Z" }) }));
  const text = lines(r, "traits");
  assert.match(text, /Сборщик стоит — упёрся в бюджет недели: потрачено \$20,00 из \$20,00, остатка не хватает даже на один вызов/);
  assert.doesNotMatch(text, /не движется|на всё уйдёт|хватит примерно на 0 вызовов/);
  assert.equal(r.problem, true);
  const ok = buildReadiness(input({ traits: traits({ weekUsd: 19, budgetCallsLeft: 12 }) }));
  assert.doesNotMatch(lines(ok, "traits"), /упёрся в бюджет недели/, "на двенадцать вызовов хватает — работаем");
});

test("Неудачный пересбор прежней версии при пустом «не разобралось»: доля неудач за 7 суток всё равно видна и поднимает тревогу", () => {
  const r = buildReadiness(input({ traits: traits({ failed: 0, recentOk: 20, recentFailed: 20 }) }));
  assert.equal(r.problem, true);
  assert.match(lines(r, "traits"), /За 7 суток неудачных 50% попыток \(пересбор разобранного по прежнему вопросу\)/);
  assert.equal(buildReadiness(input({ traits: traits({ failed: 0, recentOk: 300, recentFailed: 3 }) })).problem, false);
  assert.equal(buildReadiness(input({ traits: traits({ failed: 0, recentOk: 5, recentFailed: 5 }) })).problem, false, "10 попыток — судить рано");
});

// --- очередь сборщика: одно правило для сборщика и полоски ---

const head = (id: string, over: Partial<CatalogHead> = {}): CatalogHead => ({ sourceId: "S001", sourceItemId: id, modelKey: `S001|${id}`, direction: "bags", title: "", imageUrls: ["https://img/x.jpg"], firstSeenAt: "2026-10-01", ...over });
const prev = (over: Partial<ExistingResult> = {}): ExistingResult => ({ status: "failed", attempts: 1, promptVersion: PROMPT_VERSION, takenAt: "2026-10-01T00:00:00Z", ...over });

test("Очередь сборщика: новые + повторы + пересбор — в очередь; три попытки и нестабильный ключ — нет; пауза между попытками не меняет «сколько осталось»; pickCandidates берёт ровно то, что summarizeQueue называет очередью", () => {
  const heads = [
    head("fresh"), head("retry"), head("stale"),
    head("deadFailed"), head("deadStale"), head("unstable", { keyStable: false }),
    head("noPhoto", { imageUrls: [] }), head("ru", { sourceId: "S128", modelKey: "S128|ru" }), head("done"),
  ];
  const existing = new Map<string, ExistingResult>([
    ["S001\u0000S001|retry", prev({ attempts: 2 })],
    ["S001\u0000S001|stale", prev({ status: "ok", promptVersion: "catalog-v1", attempts: 1 })],
    ["S001\u0000S001|deadFailed", prev({ attempts: 3 })],
    ["S001\u0000S001|deadStale", prev({ status: "ok", promptVersion: "catalog-v1", attempts: 3, lastError: "ответ ИИ: все признаки «не видно»" })],
    ["S001\u0000S001|done", prev({ status: "ok" })],
  ]);
  assert.deepEqual(summarizeQueue(heads, existing), {
    queued: 3, exhausted: 2, unstable: 1,
    outside: [{ sourceId: "S001", noPhoto: 1, ru: 0, photoUnavailable: 0, exhausted: 2 }, { sourceId: "S128", noPhoto: 0, ru: 1, photoUnavailable: 0, exhausted: 0 }],
  });
  const taken = pickCandidates(heads, existing, Date.parse("2026-10-06T00:00:00Z"), 100).map((h) => h.sourceItemId).sort();
  assert.deepEqual(taken, ["fresh", "retry", "stale"], "сборщик берёт ровно очередь");
  const justTried = new Map(existing);
  justTried.set("S001\u0000S001|retry", prev({ attempts: 2, takenAt: "2026-10-05T20:00:00Z" }));
  assert.deepEqual(pickCandidates(heads, justTried, Date.parse("2026-10-06T00:00:00Z"), 100).map((h) => h.sourceItemId).sort(), ["fresh", "stale"], "повтор раньше чем через сутки сборщик сегодня не возьмёт");
  assert.equal(summarizeQueue(heads, justTried).queued, 3, "но «осталось» его считает: возьмёт, когда сутки пройдут");
});

test("Форма отчёта по признакам изменилась (в нём очередь сборщика): версия в ключе кэша ≥ 3, чтобы после выкладки не жил час отчёт без очереди", () => {
  assert.ok(TRAITS_REPORT_VERSION >= 3);
});

const demand = (over: Partial<DemandFacts> = {}): DemandFacts => ({ subjectsTotal: 9, subjectsFresh: 9, subjectsLagging: 0, withPrevious: 0, latestTo: "2026-10-04", ...over });

test("Спрос WB: срез, предметы в расчёте (как на «Формах»), отставшие названы; без даты «роста не раньше» — прошлый срез снимается вслед за текущим; свежесть; без срезов блока нет", () => {
  const fresh = buildReadiness(input({ traits: null, demand: demand() }));
  assert.match(lines(fresh, "demand"), /Срез спроса на 04\.10: предметов в расчёте 9 из 9; «прошлый» срез для роста есть у 0/);
  assert.match(lines(fresh, "demand"), /«Прошлый» срез для роста сборщик снимает вслед за текущим — колонка «Рост» появится после ближайших прогонов крона/);
  assert.doesNotMatch(lines(fresh, "demand"), /не раньше/, "никакой даты +20 дней: сборщик снимает базовый срез сразу");
  assert.equal(fresh.groups[0].lines.find((l) => /сборщик снимает/.test(l.text))?.kind, "оценка");
  assert.equal(fresh.problem, false);
  const lagging = buildReadiness(input({ traits: null, demand: demand({ subjectsFresh: 7, subjectsLagging: 2, withPrevious: 7 }) }));
  assert.match(lines(lagging, "demand"), /предметов в расчёте 7 из 9 \(ещё 2 отстали больше чем на две недели — «Формы» их не берут\); «прошлый» срез для роста есть у 7/);
  assert.doesNotMatch(lines(lagging, "demand"), /сборщик снимает/);
  const stale = buildReadiness(input({ traits: null, today: "2026-10-20", demand: demand() }));
  assert.equal(stale.problem, true);
  assert.match(lines(stale, "demand"), /Срез старше недели/);
  assert.equal(buildReadiness(input({ traits: null, demand: demand({ latestTo: null, subjectsFresh: 0 }) })).groups.length, 0, "срезов нет — блока нет (прячем, не серим)");
});

test("История каталогов: даты по каждому источнику от ЕГО первого полного прогона (+7); застрявший (второго полного нет больше 10 дней) — не дата, а проблема; без полного прогона — «ждёт»; динамика — по каждому, кому её ещё ждать", () => {
  const r = buildReadiness(input({
    traits: null,
    history: { sources: [
      src("Polène", "building", "2026-10-05"),
      src("Rains", "building", "2026-10-12"),
      src("Zara", "appearance", "2026-09-20"),
      src("ASOS", "window_only", "2026-10-05"),
      src("Uniqlo", "building", "2026-09-10", null),
      src("Sela", "building", "2026-09-10", "2026-09-10"),
    ] },
  }));
  const h = lines(r, "history");
  assert.match(h, /Вкладка «Изменения»: «появилось» и «пропало» — наблюдение: Zara\./);
  assert.match(h, /Вкладка «Изменения» копится: ASOS \(только верх выдачи\) — не раньше 12\.10; Polène — не раньше 12\.10; Rains — не раньше 19\.10\./, "у каждого источника своя дата; застрявшего Sela и ждущего Uniqlo среди них нет — у них свои строки");
  assert.match(h, /Второй полный прогон не приходит: Sela \(первый 10\.09, уже 26 дней\)\. Пока обходы не доходят до конца/);
  assert.match(h, /Ждут первого полного прогона: Uniqlo — для них даты пока нет\./);
  assert.match(h, /Динамика \(28 дней наблюдений и не меньше 4 дней с прогонами\): Zara — не раньше 18\.10; Polène — не раньше 02\.11; Rains — не раньше 09\.11\./, "по каждому: первый день +28 и первый полный +7; Uniqlo (нет полного) и Sela (застрял) без даты");
  assert.equal((h.match(/ASOS/g) ?? []).length, 1, "верх выдачи назван один раз");
  assert.doesNotMatch(h, /растёт|падает/);
  assert.equal(r.groups.find((g) => g.key === "history")!.problem, true, "застрявший источник раскрывает полоску");
  assert.equal(r.groups.find((g) => g.key === "history")!.lines.find((l) => /Второй полный/.test(l.text))?.problem, true);
  assert.equal(buildReadiness(input({ traits: null, history: { sources: [] } })).groups.length, 0);
  const only = buildReadiness(input({ traits: null, history: { sources: [src("Zara", "appearance", "2026-09-01")] } }));
  assert.match(lines(only, "history"), /Динамика .*: Zara — не раньше 06\.10\./, "appearance — ещё не динамика: её тоже ждут");
  assert.equal(only.problem, false);
});

test("История: уже готовый к динамике источник не тянет дату «динамика — не раньше сегодня» под строку «история копится»; источник без полного прогона в дату не входит", () => {
  const mixed = lines(buildReadiness(input({ traits: null, history: { sources: [
    src("Zara", "dynamics", "2026-08-01"), src("Rains", "building", "2026-10-02"), src("Sela", "building", "2026-09-10"),
  ] } })), "history");
  assert.match(mixed, /Можно смотреть динамику: Zara\./);
  assert.match(mixed, /Динамика .*: Rains — не раньше 30\.10\./, "Rains: первый день 02.10 + 28");
  assert.doesNotMatch(mixed.split("Динамика (")[1] ?? "", /Zara|Sela/, "готовый и застрявший в даты динамики не входят");
  const noFull = lines(buildReadiness(input({ traits: null, history: { sources: [
    src("Uniqlo", "building", "2026-09-01", null), src("Polène", "building", "2026-10-05"),
  ] } })), "history");
  assert.match(noFull, /Ждут первого полного прогона: Uniqlo/);
  assert.match(noFull, /Динамика .*: Polène — не раньше 02\.11\./);
  assert.doesNotMatch(noFull.split("Динамика (")[1] ?? "", /Uniqlo/, "без полного прогона даты динамики нет");
  const young = buildReadiness(input({ traits: null, history: { sources: [src("Sela", "building", "2026-09-26", "2026-09-26")] } }));
  assert.equal(young.problem, false, "10 дней после первого полного — ещё в пределах срока (7 + 3)");
  assert.doesNotMatch(lines(young, "history"), /Второй полный/);
  const old = buildReadiness(input({ traits: null, history: { sources: [src("Sela", "building", "2026-09-25", "2026-09-25")] } }));
  assert.equal(old.problem, true, "11 дней и второго полного нет — застрял");
  assert.match(lines(old, "history"), /Sela \(первый 25\.09, уже 11 дней\)/);
});

test("Полоска: свёрнута, когда всё в порядке; раскрыта сама при проблеме; сбой чтения части назван всегда; кнопка не меньше 44 px", () => {
  const ok = renderToStaticMarkup(createElement(ReadinessStrip, { report: buildReadiness(input()) }));
  assert.match(ok, /aria-expanded="false"/);
  assert.match(text(ok), /На чём стоят цифры Признаки по фото: разобрано 62 из 1\s172/);
  assert.doesNotMatch(text(ok), /Осталось разобрать/, "детали свёрнуты");
  assert.match(ok, /min-h-\[44px\]/);
  const bad = renderToStaticMarkup(createElement(ReadinessStrip, { report: buildReadiness(input({ traits: traits({ keyConfigured: false }) })) }));
  assert.match(bad, /aria-expanded="true"/);
  assert.match(text(bad), /нужно внимание/);
  assert.match(text(bad), /факт Сборщик стоит — нет ключа ИИ/);
  assert.match(text(bad), /расчёт|Даты — расчёт по текущим порогам, а не обещание/);
  const failed = renderToStaticMarkup(createElement(ReadinessStrip, { report: buildReadiness(input({ traits: null, errors: ["спрос на WB (таймаут)"] })) }));
  assert.match(text(failed), /Не загрузилось: спрос на WB \(таймаут\)\./, "когда не осталось ни одного блока, сбой всё равно виден");
  const both = renderToStaticMarkup(createElement(ReadinessStrip, { report: buildReadiness(input({ errors: ["история каталогов"] })) }));
  assert.match(text(both), /Не загрузилось: история каталогов\./);
  assert.match(text(both), /На чём стоят цифры/, "и остальное показано");
  assert.equal(renderToStaticMarkup(createElement(ReadinessStrip, { report: { groups: [], problem: false, errors: [] } })), "", "нет данных и нет сбоев — полоски нет");
});

test("Признаки по фото: ошибка чтения названа, а не проглочена", () => {
  assert.match(text(renderToStaticMarkup(createElement(PhotoTraitsError, { message: "Нет связи с сервером" }))), /Признаки по фото не загрузились: Нет связи с сервером\./);
});

// --- чтение базы ---

// Хранилище читает настройки сборщика из окружения: задаём ключ Polza, чтобы условия были «рабочими» (иначе «нет ключа» — остановка).
process.env.POLZA_API_KEY = "test-key";
delete process.env.ASSORTMENT_CATALOG_AI_PROVIDER;

type Row = Record<string, unknown>;
function fakeDb(tables: Record<string, Row[]>, opts: { missing?: string[]; failing?: string[]; failIf?: (table: string, filters: string[]) => boolean } = {}) {
  const calls: Array<{ table: string; filters: string[] }> = [];
  const db = {
    from: (table: string) => {
      const call = { table, filters: [] as string[] };
      calls.push(call);
      const preds: Array<(r: Row) => boolean> = [];
      let wantCount = false;
      let sortCol: string | null = null;
      let desc = false;
      let max = Infinity;
      const rows = () => {
        let list = (tables[table] ?? []).filter((r) => preds.every((p) => p(r)));
        if (sortCol) list = list.slice().sort((a, b) => (String(a[sortCol as string]) < String(b[sortCol as string]) ? -1 : 1) * (desc ? -1 : 1));
        return list.slice(0, max);
      };
      const failure = () => (opts.missing?.includes(table) ? { code: "42P01", message: `relation "${table}" does not exist` } : opts.failing?.includes(table) || opts.failIf?.(table, call.filters) ? { message: "таймаут запроса" } : null);
      const result = () => (failure() ? { data: null, error: failure(), count: null } : { data: rows(), error: null, count: wantCount ? (tables[table] ?? []).filter((r) => preds.every((p) => p(r))).length : null });
      const q: Record<string, unknown> = {
        select: (_c: string, o?: { count?: string }) => { wantCount = Boolean(o?.count); return q; },
        eq: (c: string, v: unknown) => { call.filters.push(`eq:${c}=${v}`); preds.push((r) => r[c] === v); return q; },
        neq: (c: string, v: unknown) => { preds.push((r) => r[c] !== v); return q; },
        is: (c: string, v: unknown) => { call.filters.push(`is:${c}`); preds.push((r) => (v === null ? r[c] == null : r[c] === v)); return q; },
        not: (c: string, op: string, v: unknown) => { call.filters.push(`not:${c}`); preds.push((r) => (op === "is" && v === null ? r[c] != null : r[c] !== v)); return q; },
        gte: (c: string, v: unknown) => { call.filters.push(`gte:${c}`); preds.push((r) => String(r[c] ?? "") >= String(v)); return q; },
        order: (c: string, o?: { ascending?: boolean }) => { sortCol = c; desc = o?.ascending === false; return q; },
        limit: (n: number) => { max = n; return q; },
        range: (a: number, b: number) => Promise.resolve(failure() ? { data: null, error: failure() } : { data: rows().slice(a, b + 1), error: null }),
        maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: failure() }),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve),
      };
      return q;
    },
  };
  return { db: db as never, calls };
}

const report = (over: Partial<PhotoTraitsReport> = {}): PhotoTraitsReport => ({ direction: "bags", analyzed: 4, legacy: 0, catalog: 1000, coverage: 0.4, sourcesInAverage: 0, basis: "raw", averageCoverage: 0, fields: [], ...over });
const attr = (status: string, over: Row = {}): Row => ({ direction: "bags", status, prompt_version: PROMPT_VERSION, last_error: null, taken_at: "2026-10-06T08:00:00Z", model_key: Math.random().toString(36), ...over });

const headRow = (direction: string, id: string, over: Row = {}): Row => ({
  source_id: "S001", source_item_id: id, model_key: `S001|${id}`, direction, title: null, image_urls: [`https://img/${id}.jpg`], model_first_seen_at: "2026-10-01T00:00:00Z",
  model_last_seen_at: "2026-10-05T00:00:00Z", model_hidden_at: null, ...over,
});
const result = (direction: string, id: string, over: Row = {}): Row => ({ source_id: "S001", model_key: `S001|${id}`, direction, status: "ok", attempts: 1, prompt_version: PROMPT_VERSION, last_error: null, taken_at: "2026-10-06T08:00:00Z", ...over });

test("Чтение базы: «разобрано N из M» и очередь — из того же отчёта, что блок «Признаки по фото» (скрытые и пропавшие модели не в числителе); остаток другого раздела; неудачи и последняя модель; неудачный пересбор — не «последняя разобрана»", async () => {
  const seen: string[] = [];
  const traitsLoader = async (_db: unknown, direction: string) => {
    seen.push(direction);
    return direction === "bags"
      ? report({ analyzed: 4, legacy: 3, catalog: 1000, queue: { queued: 990, exhausted: 3, unstable: 0 } })
      : report({ direction: "jackets", analyzed: 900, catalog: 1300, queue: { queued: 400, exhausted: 0, unstable: 0 } });
  };
  const { db } = fakeDb({
    // 40 строк результатов в базе, но в текущем каталоге из них только 4: остальные скрыты или пропали с сайта — отчёт их уже отсёк
    assortment_model_attributes: [
      ...Array.from({ length: 40 }, () => attr("ok")),
      attr("failed", { last_error: "HTTP 403" }), attr("failed", { last_error: "HTTP 403" }), attr("failed", { last_error: "фото не скачалось" }),
      attr("ok", { taken_at: "2026-10-06T09:30:00Z" }),
      // неудачный пересбор старой строки: статус «ok» остаётся, в last_error — причина, taken_at — время НЕУДАЧНОЙ попытки
      attr("ok", { taken_at: "2026-10-06T09:45:00Z", last_error: "HTTP 500", prompt_version: "catalog-v1" }),
    ],
    assortment_ai_usage: [{ day: "2026-10-06", kind: "catalog_attributes", calls: 40, cost_usd: 0.07 }],
  });
  const r = await loadReadiness(db, "bags", new Date("2026-10-06T10:00:00Z"), { traits: traitsLoader as never });
  const t = lines(r, "traits");
  assert.match(t, /Разобрано по фото 4 из 1\s000 моделей \(0,4%\)/, "числитель — отчёт по каталогу, а не 41 строка таблицы");
  assert.match(t, /ещё 3 разобраны по прежнему вопросу/);
  assert.match(t, /Осталось разобрать 990 \(в другом разделе ещё 400: очередь у сборщика общая\)/, "очередь — из отчёта, а не «каталог минус разобрано»");
  assert.match(t, /Ещё 3 модели сборщик не возьмёт: 3 исчерпали три попытки/);
  assert.match(t, /Не разобралось 3 модели .*: HTTP 403 \(2\); фото не скачалось \(1\)/);
  assert.match(t, /Последняя модель разобрана 06\.10 в 12:30 МСК/, "неудачный пересбор в 12:45 — не «последняя разобрана»");
  assert.deepEqual(seen.sort(), ["bags", "jackets"], "отчёт по двум разделам — как у блока на экране");
  assert.deepEqual(r.errors, []);
});

test("Чтение базы: не прочиталось время последней разобранной модели — это строка в errors, а не «ни одна модель не разобрана»; очередь без отчёта берётся из подставленного загрузчика (кэш на проде)", async () => {
  const { db } = fakeDb(
    { assortment_model_attributes: Array.from({ length: 62 }, () => attr("ok")), assortment_ai_usage: [{ day: "2026-10-06", kind: "catalog_attributes", calls: 40, cost_usd: 0.07 }] },
    { failIf: (table, filters) => table === "assortment_model_attributes" && filters.includes("is:last_error") && !filters.some((f) => f.startsWith("gte:")) },
  );
  const queued: string[] = [];
  const r = await loadReadiness(db, "bags", new Date("2026-10-06T10:00:00Z"), {
    traits: (async () => null) as never,
    queue: (async (_db: unknown, direction: string) => { queued.push(direction); return { eligible: 100, queue: { queued: 38, exhausted: 0, unstable: 0 } }; }) as never,
  });
  assert.ok(r.errors.some((e) => /^время последней разобранной модели/.test(e)), "сбой назван");
  assert.doesNotMatch(lines(r, "traits"), /Ни одна модель не разобрана/);
  assert.deepEqual(queued.sort(), ["bags", "jackets"], "очередь двух разделов — через загрузчик, а не прямым чтением вида голов");
  assert.match(lines(r, "traits"), /Осталось разобрать 38 \(в другом разделе ещё 38/);
});

test("Чтение базы: доля неудач за 7 суток — по ЭТОМУ разделу: сбои сумок в «Куртках», где их нет, тревоги не дают; жив ли сборщик — по всей таблице", async () => {
  const rows = [
    ...Array.from({ length: 30 }, () => attr("failed", { direction: "jackets", last_error: "фото не скачалось" })),
    ...Array.from({ length: 5 }, () => attr("ok", { direction: "jackets" })),
    ...Array.from({ length: 25 }, () => attr("ok", { direction: "bags" })),
  ];
  const traitsLoader = (async (_db: unknown, direction: string) => report({ direction: direction as "bags" | "jackets", analyzed: 25, queue: { queued: 10, exhausted: 0, unstable: 0 } })) as never;
  const bags = await loadReadiness(fakeDb({ assortment_model_attributes: rows }).db, "bags", new Date("2026-10-06T10:00:00Z"), { traits: traitsLoader });
  assert.equal(bags.problem, false, "у сумок 25 удач и ни одной неудачи");
  assert.doesNotMatch(lines(bags, "traits"), /неудачных/);
  const jackets = await loadReadiness(fakeDb({ assortment_model_attributes: rows }).db, "jackets", new Date("2026-10-06T10:00:00Z"), { traits: traitsLoader });
  assert.match(lines(jackets, "traits"), /За 7 суток неудачных 86% попыток/, "у курток 30 неудач из 35");
  assert.equal(jackets.problem, true);
  assert.doesNotMatch(lines(bags, "traits"), /ничего не пробовал/, "сборщик жив: последняя попытка свежая по всей таблице");
});

test("Чтение базы: нет вида каталога — «из 0» и «очередь разобрана» не пишутся; миграция названа; очередь другого раздела — в errors", async () => {
  const { db } = fakeDb({ assortment_model_attributes: [attr("failed", { last_error: "x" })] }, { missing: ["assortment_catalog_heads"] });
  const r = await loadReadiness(db, "bags", new Date("2026-10-06T10:00:00Z"), { traits: (async () => null) as never });
  const t = lines(r, "traits");
  assert.match(t, /Каталога для разбора ещё нет \(не применена миграция 202610050002\)/);
  assert.doesNotMatch(t, /Очередь разобрана/);
  assert.ok(r.errors.some((e) => /очередь другого раздела \(нет вида каталога/.test(e)));
  assert.equal(r.problem, true);
});

test("История на экране «Куртки»: источники, у которых куртки не собираются (категории только сумки), не перечисляются, хотя прогон Shopify пишется без раздела", async () => {
  const run = (source: string, day: string, direction: string | null = null) => ({ source_id: source, direction, observed_on: day, coverage: "full", seen: 10, added: 0, error: null, started_at: `${day}T08:00:00Z` });
  const { db } = fakeDb({
    assortment_model_attributes: [],
    assortment_run: [run("S001", "2026-09-27", "jackets"), run("S001", "2026-10-04", "jackets"), run("S027", "2026-09-27"), run("S027", "2026-10-04"), run("S040", "2026-09-27"), run("S040", "2026-10-04")],
    assortment_sources: [
      { source_id: "S001", name: "Zara", categories: ["jackets", "bags"] },
      { source_id: "S027", name: "JW PEI", categories: ["bags"] },
      { source_id: "S040", name: "Rains", categories: ["jackets", "bags"] },
    ],
  });
  const jackets = await loadReadiness(db, "jackets", new Date("2026-10-06T10:00:00Z"), { traits: (async () => null) as never });
  const h = lines(jackets, "history");
  assert.match(h, /Zara/);
  assert.match(h, /Rains/);
  assert.doesNotMatch(h, /JW PEI/, "сумочный бренд в истории курток не нужен");
  const bags = await loadReadiness(db, "bags", new Date("2026-10-06T10:00:00Z"), { traits: (async () => null) as never });
  assert.match(lines(bags, "history"), /JW PEI/);
});

test("Чтение базы: неудачный пересбор считается неудачей — доля за 7 суток растёт, даже когда «не разобралось» пусто", async () => {
  const { db } = fakeDb({
    assortment_model_attributes: [
      ...Array.from({ length: 25 }, () => attr("ok")),
      ...Array.from({ length: 25 }, () => attr("ok", { last_error: "HTTP 500", prompt_version: "catalog-v1" })),
    ],
  });
  const r = await loadReadiness(db, "bags", new Date("2026-10-06T10:00:00Z"), { traits: (async () => report({ queue: { queued: 10, exhausted: 0, unstable: 0 } })) as never });
  assert.match(lines(r, "traits"), /За 7 суток неудачных 50% попыток \(пересбор разобранного по прежнему вопросу\)/);
  assert.equal(r.problem, true);
});

test("Чтение базы: раздел без единого разбора — очередь из каталога и результатов (неудачи с тремя попытками, «Рынок РФ» и нестабильный ключ не в счёт); очередь другого раздела не прочиталась — это сбой в errors, а не «очередь разобрана»", async () => {
  const noReport = async () => null;
  const heads = [
    headRow("bags", "a"), headRow("bags", "b"), headRow("bags", "c"), headRow("bags", "ru", { source_id: "S128", model_key: "S128|ru" }),
    headRow("bags", "nokey", { model_key: "S001|stale-key" }), headRow("bags", "nophoto", { image_urls: [] }),
    headRow("jackets", "j1"), headRow("jackets", "j2"), headRow("jackets", "j3"),
  ];
  const fixture = () => ({
    assortment_catalog_heads: heads,
    assortment_model_attributes: [
      result("bags", "b", { status: "failed", attempts: 1, taken_at: "2026-10-04T08:00:00Z", last_error: "x" }),
      result("bags", "c", { status: "failed", attempts: 3, taken_at: "2026-10-04T08:00:00Z", last_error: "x" }),
    ],
    assortment_run: [{ source_id: "S001", direction: "bags", observed_on: "2026-10-05", coverage: "full", seen: 1, added: 0, error: null, started_at: "2026-10-05T08:00:00Z" }],
    assortment_sources: [{ source_id: "S001", name: "Zara" }],
  });
  const ok = await loadReadiness(fakeDb(fixture(), { failing: ["assortment_wb_query_snapshot"] }).db, "bags", new Date("2026-10-06T10:00:00Z"), { traits: noReport as never });
  const t = lines(ok, "traits");
  assert.match(t, /Разобрано по фото 0 из 4 моделей \(0%\)/, "знаменатель — с фото, без «Рынка РФ» (нестабильный ключ в нём остаётся)");
  assert.match(t, /Осталось разобрать 2 \(в другом разделе ещё 3: очередь у сборщика общая\)/, "a — новая, b — повтор; c исчерпала попытки, nokey ждёт обхода; в другом разделе — 3 новых, а не молчаливый ноль");
  assert.match(t, /Ещё 2 модели сборщик не возьмёт: 1 исчерпали три попытки; у 1 ключ модели в базе не совпал с расчётным/);
  assert.deepEqual(ok.groups.map((g) => g.key), ["traits", "history"], "спрос не прочитался — блока нет, остальные есть");
  assert.deepEqual(ok.errors, ["спрос на WB (таймаут запроса)"], "сбой назван, а не спрятан");

  // Очередь другого раздела не читается: «очередь разобрана» не пишем, сбой называем, остальное живо.
  const brokenOther = await loadReadiness(
    fakeDb(fixture(), { failIf: (table, filters) => table === "assortment_catalog_heads" && filters.includes("eq:direction=jackets") }).db,
    "bags", new Date("2026-10-06T10:00:00Z"), { traits: noReport as never },
  );
  const bt = lines(brokenOther, "traits");
  assert.match(bt, /Осталось разобрать 2 \(очередь другого раздела не прочиталась — срок без неё\)/);
  assert.ok(brokenOther.errors.some((e) => /^очередь другого раздела/.test(e)), "названа в errors");
  assert.ok(brokenOther.groups.some((g) => g.key === "traits"), "блок про свой раздел не пропал");
  const emptyOwn = fakeDb({ ...fixture(), assortment_catalog_heads: heads.filter((h) => h.direction === "jackets") }, { failIf: (table, filters) => table === "assortment_catalog_heads" && filters.includes("eq:direction=jackets") });
  const quiet = await loadReadiness(emptyOwn.db, "bags", new Date("2026-10-06T10:00:00Z"), { traits: noReport as never });
  assert.doesNotMatch(lines(quiet, "traits"), /Очередь разобрана/, "пустой свой раздел и нечитаемый чужой — не «очередь разобрана»");
  assert.match(lines(quiet, "traits"), /очередь другого раздела не прочиталась — общий срок посчитать нельзя/);

  // Упавший каталог своего раздела — сбой всего блока, а не «100%».
  const broken = fakeDb({ assortment_model_attributes: [], assortment_catalog_heads: [] }, { failing: ["assortment_catalog_heads"] });
  const r2 = await loadReadiness(broken.db, "bags", new Date("2026-10-06T10:00:00Z"), { traits: noReport as never });
  assert.ok(r2.errors.some((e) => /признаки по фото/.test(e)), "упавший каталог — это сбой, а не «100%»");
  assert.equal(r2.groups.some((g) => g.key === "traits"), false);
});

test("Чтение базы: спрос — как на «Формах» (отставшие предметы не в расчёте), окно 150 дней; история — только раздел и прогоны «целиком», у каждого источника своя дата", async () => {
  const snap = (id: number, to: string, direction = "jackets") => ({ subject_id: id, window_to: to, direction });
  const run = (source: string, direction: string | null, day: string, coverage = "full") => ({ source_id: source, direction, observed_on: day, coverage, seen: 10, added: 0, error: null, started_at: `${day}T08:00:00Z` });
  const { db, calls } = fakeDb({
    assortment_model_attributes: [],
    assortment_wb_query_snapshot: [
      snap(168, "2026-10-04"), snap(168, "2026-09-04"), snap(174, "2026-10-04"),
      snap(172, "2026-09-10"), // отстал больше двух недель от самого свежего
      snap(170, "2026-05-01"), // старше окна чтения
    ],
    assortment_run: [
      run("S001", "jackets", "2026-09-27"), run("S001", "jackets", "2026-10-04"), run("S001", "bags", "2026-10-04"), // у Zara по курткам два полных, по сумкам один
      run("S040", "jackets", "2026-10-04"), // источник только по курткам
      run("S027", null, "2026-10-05"), // Shopify: обход целиком — относится к обоим разделам
    ],
    assortment_sources: [{ source_id: "S001", name: "Zara" }, { source_id: "S040", name: "JacketsOnly" }, { source_id: "S027", name: "JW PEI" }],
  });
  const jackets = await loadReadiness(db, "jackets", new Date("2026-10-06T10:00:00Z"), { traits: (async () => null) as never });
  assert.match(lines(jackets, "demand"), /Срез спроса на 04\.10: предметов в расчёте 2 из 9 \(ещё 1 отстали больше чем на две недели — «Формы» их не берут\); «прошлый» срез для роста есть у 1/);
  assert.ok(calls.some((c) => c.table === "assortment_wb_query_snapshot" && c.filters.some((f) => f.startsWith("gte:window_to"))), "окно чтения ограничено — предел 1 000 строк не наступит молча");
  const bags = await loadReadiness(db, "bags", new Date("2026-10-06T10:00:00Z"), { traits: (async () => null) as never });
  const hb = lines(bags, "history");
  assert.doesNotMatch(hb, /JacketsOnly/, "источник только по курткам на экране сумок не упоминается");
  assert.doesNotMatch(hb, /наблюдение: Zara/, "по сумкам у Zara один полный прогон — это не наблюдение");
  assert.match(hb, /Вкладка «Изменения» копится: Zara — не раньше 11\.10; JW PEI — не раньше 12\.10\./);
  const hj = lines(jackets, "history");
  assert.match(hj, /Вкладка «Изменения»: пока только «появилось», «пропало» — после 2 полных прогонов подряд без модели: Zara — после ещё 1 полного прогона\./, "по курткам два полных с разрывом 7 дней: «появилось» — наблюдение, для «пропало» нужен третий");
  assert.doesNotMatch(hj, /наблюдение: Zara/, "двух полных прогонов мало для «пропало» — и полоска этого не утверждает");
});

test("Роут и экран: под сессией модуля, числа — из общего кэшированного отчёта, MPSTATS и ИИ не вызываются; полоска не ждёт «Форм»", () => {
  const route = readFileSync(join(root, "app/api/assortment-development/data-readiness/route.ts"), "utf8");
  assert.match(route, /requireApiSession\(ASSORTMENT_ROLES\)/);
  assert.match(route, /export const dynamic = "force-dynamic"/);
  assert.match(route, /\{ traits: loadPhotoTraitsCached, queue: loadQueueCached \}/, "тот же отчёт и тот же кэш, что у блока «Признаки по фото»; очередь раздела без отчёта — тоже через часовой кэш");
  assert.doesNotMatch(route, /^import .*(mpstats|anthropic|polza|runCatalogAi)/im, "роут не тянет клиенты MPSTATS и ИИ");
  const store = readFileSync(join(root, "lib/assortment/dataReadinessStore.ts"), "utf8");
  assert.doesNotMatch(store.replace(/\/\*[\s\S]*?\*\//g, ""), /lib\/mpstats|mpstatsWbQuota|runCatalogAi|askFor\(/, "и хранилище: ни квоты MPSTATS, ни запуска разбора");
  const traitsRoute = readFileSync(join(root, "app/api/assortment-development/photo-traits/route.ts"), "utf8");
  assert.match(traitsRoute, /loadPhotoTraitsCached\(db, direction\)/);
  const forms = readFileSync(join(root, "components/assortment/FormsView.tsx"), "utf8");
  const mount = forms.indexOf("<DataReadiness");
  assert.ok(mount > 0 && mount < forms.indexOf('state.kind === "loading"'), "полоска стоит выше веток загрузки «Форм»: у неё свой запрос, она не ждёт отчёт и не сдвигает его");
});

test("История каталогов: у источника с частями разделов «появилось/пропало» оговорено — модели частей в полный прогон не входят", async () => {
  const r = buildReadiness(input({ traits: null, history: { sources: [{ ...src("Zara", "appearance", "2026-09-20"), parts: ["Zara CHAQUETA без трикотажа"] }, src("Rains", "appearance", "2026-09-20")] } }));
  const h = lines(r, "history");
  assert.match(h, /Вкладка «Изменения»: «появилось» и «пропало» — наблюдение: Zara, Rains\./);
  assert.match(h, /Части разделов в полный прогон не входят — по их моделям «появилось» и «пропало» не наблюдение: Zara \(Zara CHAQUETA без трикотажа\)\./);
  assert.doesNotMatch(h, /Rains \(/);
  assert.match(lines(buildReadiness(input({ traits: null, history: { sources: [{ ...src("Zara", "dynamics", "2026-08-20"), parts: ["Zara CHAQUETA без трикотажа"] }] } })), "history"), /не наблюдение: Zara \(Zara CHAQUETA без трикотажа\)\./, "и при динамике по источнику — оговорка");
  assert.doesNotMatch(lines(buildReadiness(input({ traits: null, history: { sources: [{ ...src("Zara", "building", "2026-10-01"), parts: ["Zara CHAQUETA без трикотажа"] }] } })), "history"), /Части разделов/, "история ещё копится — оговаривать нечего");
  assert.doesNotMatch(lines(buildReadiness(input({ traits: null, history: { sources: [src("Zara", "appearance", "2026-09-20")] } })), "history"), /Части разделов/, "частей нет — оговорки нет");
  // Из базы: прогоны части помечены в журнале — название части берётся из списка частей.
  const run = (day: string, over: Row = {}) => ({ source_id: "S001", direction: "jackets", observed_on: day, coverage: "full", seen: 10, added: 0, error: null, started_at: `${day}T06:30:00Z`, ...over });
  const { db } = fakeDb({
    assortment_model_attributes: [],
    assortment_run: [run("2026-09-27"), run("2026-10-04"), run("2026-10-04", { coverage: "window", part: "zara_chaqueta", started_at: "2026-10-04T06:40:00Z" })],
    assortment_sources: [{ source_id: "S001", name: "Zara", categories: ["jackets", "bags"] }],
  });
  const loaded = lines(await loadReadiness(db, "jackets", new Date("2026-10-06T10:00:00Z"), { traits: (async () => null) as never }), "history");
  assert.match(loaded, /не наблюдение: Zara \(Zara CHAQUETA без трикотажа\)\./);
});

// --- Ф1 (06.10): причина остановки сборщика словами и «вне разбора» по источникам ---

const outsideOf = (sourceId: string, name: string, over: Partial<{ noPhoto: number; ru: number; photoUnavailable: number; exhausted: number }> = {}) => ({ sourceId, name, noPhoto: 0, ru: 0, photoUnavailable: 0, exhausted: 0, ...over });

test("Ф1: строка «вне разбора» по источникам — без ссылок на фото, сайты РФ, фото недоступно, исчерпаны 3 попытки; что входит в «из M», а что нет, сказано; пусто — строки нет", () => {
  const outside = [
    outsideOf("S001", "Zara", { noPhoto: 125, photoUnavailable: 10, exhausted: 2 }),
    outsideOf("S007", "H&M", { noPhoto: 7 }),
    outsideOf("S128", "Lime", { ru: 300 }),
    outsideOf("S040", "Rains", { photoUnavailable: 2 }),
  ];
  const r = buildReadiness(input({ traits: traits({ outside }) }));
  const line = r.groups[0].lines.find((l) => l.text.startsWith("Вне разбора"))!;
  assert.equal(line.kind, "факт");
  assert.equal(line.problem, undefined, "это не поломка — это граница данных");
  assert.match(line.text, /без ссылок на фото — 132 \(Zara 125, H&M 7\)/);
  assert.match(line.text, /сайты РФ — 300 \(Lime 300\): ориентир, а не референс — ИИ их не разбирает/);
  assert.match(line.text, /фото недоступно — 12 \(Zara 10, Rains 2\): ИИ три раза не смог его скачать/);
  assert.match(line.text, /исчерпаны 3 попытки по другим причинам — 2 \(Zara 2\)/);
  assert.match(line.text, /Модели без фото и сайты РФ в «из 1\s172» не входят; «фото недоступно» и исчерпавшие попытки в «из 1\s172» входят, но не разберутся\./);
  assert.equal(r.problem, false);
  const many = buildReadiness(input({ traits: traits({ outside: ["A", "B", "C", "D", "E", "F"].map((n, i) => outsideOf(`S00${i}`, n, { noPhoto: 10 - i })) }) }));
  assert.match(lines(many, "traits"), /без ссылок на фото — 45 \(A 10, B 9, C 8, D 7 и ещё 2 источника\)\. Модели без фото в «из 1\s172» не входят\./);
  assert.doesNotMatch(lines(buildReadiness(input({ traits: traits({ outside: [] }) })), "traits"), /Вне разбора/);
  assert.doesNotMatch(lines(buildReadiness(input()), "traits"), /Вне разбора/, "отчёт прежней формы — строки нет, а не нули");
});

test("Ф1: причина остановки из журнала крона — словами и с ответом провайдера: нет денег (402), ключ не принят, лимит, модель, сбой; «не движется, проверьте журнал» тогда не пишем", () => {
  const stalled = { lastOkAt: "2026-10-04T08:00:00Z", lastAttemptAt: "2026-10-04T08:00:00Z", callsToday: 0 };
  const billing = buildReadiness(input({ traits: traits({ ...stalled, lastRun: { at: "2026-10-06T08:40:00Z", status: "error", reason: "billing", message: "Polza: на счёте нет средств или исчерпан лимит расходов ключа: Insufficient balance" } }) }));
  const t = lines(billing, "traits");
  assert.match(t, /Последний прогон 06\.10 в 11:40 МСК остановился — нет денег \(402\): на счёте провайдера нет средств или исчерпан лимит расходов ключа\. Ответ: Polza: на счёте нет средств/);
  assert.doesNotMatch(t, /не движется|проверьте журнал/, "причина известна — гадать незачем");
  assert.equal(billing.problem, true);
  const cases: Array<[string, RegExp]> = [["auth", /ключ не принят провайдером \(401\/403\)/], ["rate_limit", /лимит запросов провайдера \(429\)/], ["config", /модель недоступна у провайдера/], ["errors", /системный сбой/]];
  for (const [reason, re] of cases) {
    const r = buildReadiness(input({ traits: traits({ lastRun: { at: "2026-10-06T08:40:00Z", status: "error", reason: reason as never, message: null } }) }));
    assert.match(lines(r, "traits"), re, reason);
    assert.equal(r.problem, true, reason);
  }
  const partial = buildReadiness(input({ traits: traits({ lastRun: { at: "2026-10-06T08:40:00Z", status: "partial", reason: "rate_limit", message: null } }) }));
  assert.doesNotMatch(lines(partial, "traits"), /остановился/, "лимит при разобранных моделях — «медленнее», а не остановка");
  const stale = buildReadiness(input({ traits: traits({ lastRun: { at: "2026-10-06T08:40:00Z", status: "error", reason: "no_key", message: null } }) }));
  assert.doesNotMatch(lines(stale, "traits"), /остановился/, "ключ уже задан (по окружению) — старая метка «нет ключа» не повторяется");
  const off = buildReadiness(input({ traits: traits({ enabled: false, lastRun: { at: "2026-10-06T08:40:00Z", status: "error", reason: "billing", message: null } }) }));
  assert.doesNotMatch(lines(off, "traits"), /Последний прогон/, "выключен настройкой — это и есть причина, журнал не дублирует");
});

test("Ф1: «ещё не запускался» — когда в журнале крона нет ни одного прогона и следов попыток нет; потолок суток назван словами и не тревога", () => {
  const quiet = { analyzed: 0, queued: 4000, recentOk: 0, lastOkAt: null, lastAttemptAt: null, callsToday: 0, weekUsd: 0 };
  const never = buildReadiness(input({ traits: traits({ ...quiet, lastRun: null }) }));
  assert.match(lines(never, "traits"), /сборщик ещё не запускался — в журнале крона нет ни одного прогона с работой/);
  assert.equal(never.problem, false);
  const ran = buildReadiness(input({ traits: traits({ ...quiet, lastRun: { at: "2026-10-06T08:40:00Z", status: "ok", reason: null, message: "очередь пуста" } }) }));
  assert.match(lines(ran, "traits"), /последний прогон крона — 06\.10 в 11:40 МСК \(очередь пуста\)/);
  const capped = buildReadiness(input({ traits: traits({ callsToday: 1500, dailyLimit: 1500 }) }));
  assert.match(lines(capped, "traits"), /Сборщик упёрся в потолок суток: сегодня больше не разбирает, продолжит после 00:00 МСК\./);
  assert.equal(capped.problem, false);
  assert.doesNotMatch(lines(buildReadiness(input()), "traits"), /потолок суток/);
  // сборщик и так стоит (выключен, нет ключа) — «упёрся в потолок суток» рядом с этим было бы второй, ложной причиной
  for (const stopped of [{ enabled: false }, { keyConfigured: false }]) {
    const t = lines(buildReadiness(input({ traits: traits({ ...stopped, callsToday: 1500, dailyLimit: 1500 }) })), "traits");
    assert.match(t, /Сборщик стоит/);
    assert.doesNotMatch(t, /упёрся в потолок суток/, JSON.stringify(stopped));
  }
});

test("Ф1: чтение базы — последняя строка журнала крона разбора даёт причину; журнал не прочитался — сбой назван, а не «ещё не запускался»; «вне разбора» с именами источников", async () => {
  const fixture = () => ({
    assortment_catalog_heads: [
      headRow("bags", "a"), headRow("bags", "nophoto", { image_urls: [] }), headRow("bags", "ru", { source_id: "S128", model_key: "S128|ru" }),
      headRow("bags", "dead"),
    ],
    assortment_model_attributes: [result("bags", "dead", { status: "failed", attempts: 3, last_error: "Polza 400: не удалось скачать картинку: request timed out", taken_at: "2026-10-04T08:00:00Z" })],
    assortment_sources: [{ source_id: "S001", name: "Zara" }, { source_id: "S128", name: "Lime" }],
    sync_log: [
      { job: CATALOG_AI_JOB, status: "ok", error: null, started_at: "2026-10-05T08:40:00Z" },
      { job: CATALOG_AI_JOB, status: "error", error: `Polza: на счёте нет средств ${stopTag("billing")}`, started_at: "2026-10-06T06:40:00Z" },
      { job: "assortment-wb-queries", status: "error", error: "чужая задача", started_at: "2026-10-06T09:00:00Z" },
    ],
  });
  const noReport = async () => null;
  const r = await loadReadiness(fakeDb(fixture()).db, "bags", new Date("2026-10-06T10:00:00Z"), { traits: noReport as never });
  const t = lines(r, "traits");
  assert.match(t, /Последний прогон 06\.10 в 09:40 МСК остановился — нет денег \(402\).*Ответ: Polza: на счёте нет средств\./);
  assert.match(t, /Вне разбора по источникам: без ссылок на фото — 1 \(Zara 1\); сайты РФ — 1 \(Lime 1\).*; фото недоступно — 1 \(Zara 1\)/);
  const broken = await loadReadiness(fakeDb(fixture(), { failing: ["sync_log"] }).db, "bags", new Date("2026-10-06T10:00:00Z"), { traits: noReport as never });
  assert.ok(broken.errors.some((e) => /^журнал прогонов разбора/.test(e)), "сбой чтения журнала назван");
  assert.doesNotMatch(lines(broken, "traits"), /ещё не запускался — в журнале/, "не прочитали — не значит «не запускался»");
  const empty = await loadReadiness(fakeDb({ ...fixture(), sync_log: [] }).db, "bags", new Date("2026-10-06T10:00:00Z"), { traits: noReport as never });
  assert.doesNotMatch(lines(empty, "traits"), /остановился/);
});

// --- Ф2: расход движка ---

test("Ф2: строка «Расход недели по статьям» — Polza факт провайдера, Bright Data оценка по записям, рилсы оценка по запросам, итог против потолка; резерв под каталоги; расхода нет — блока нет", async () => {
  const { engineWeek, engineReserveUsd, engineRoomUsd } = await import("../lib/assortment/engineBudget.ts");
  const week = engineWeek([
    { kind: "catalog_attributes", cost_usd: 4.1 }, { kind: "brightdata:zara", cost_usd: 2.4 }, { kind: "brightdata:zara_photos", cost_usd: "1.8" }, { kind: "brightdata:asos", cost_usd: 0.3 },
    { kind: "brightdata_social", cost_usd: 1.2 }, { kind: "lock:catalog_attributes", cost_usd: 0 }, { kind: "other_ai", cost_usd: 99 },
  ]);
  const config = { weeklyUsd: 30, socialWeeklyUsd: 3 };
  const report = buildReadiness(input({ spend: { week, config, aiProvider: "polza" } }));
  const t = lines(report, "spend");
  assert.match(t, /^Расход недели по статьям \(7 дней\): разбор по фото \(Polza\) \$4,10 — факт провайдера; Bright Data: Zara \$2,40, фото Zara \$1,80, ASOS \$0,30 — оценка по записям; рилсы Instagram \$1,20 — оценка по запросам \(строка соцсетей \$3,00\)\. Итого \$9,80 из \$30,00\./, "чужое назначение и замок в итог не входят");
  const usd = (n: number) => `$${n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  assert.ok(t.includes(`Под каталоги до конца недели отложено ${usd(engineReserveUsd(week, 2))} (Zara и Uniqlo по средам отказывают последними): разбору по фото и рилсам доступно ещё ${usd(engineRoomUsd(week, "catalog_attributes", config))}.`));
  assert.equal(report.groups.find((g) => g.key === "spend")!.problem, false);
  assert.equal(report.groups.find((g) => g.key === "spend")!.lines[0].kind, "оценка", "в итоге есть оценки Bright Data — строка помечена «оценка»");
  const html = text(renderToStaticMarkup(createElement(ReadinessStrip, { report })));
  assert.match(html, /Расход движка: \$9,80 из \$30,00 за 7 дней/, "итог виден и в свёрнутой полоске");
  // Anthropic — расчёт по токенам, а не факт.
  assert.match(lines(buildReadiness(input({ spend: { week, config, aiProvider: "anthropic" } })), "spend"), /разбор по фото \(Anthropic\) \$4,10 — расчёт по токенам/);
  // Потолок выбран — проблема, полоска раскрыта.
  const full = buildReadiness(input({ spend: { week: engineWeek([{ kind: "catalog_attributes", cost_usd: 19 }, { kind: "brightdata:uniqlo", cost_usd: 11 }]), config, aiProvider: "polza" } }));
  assert.equal(full.problem, true);
  assert.match(lines(full, "spend"), /Потолок недели \$30,00 выбран: платные запуски ждут/);
  assert.match(lines(full, "spend"), /выборок Bright Data не было|Uniqlo \$11,00/);
  assert.equal(buildReadiness(input({ spend: { week: engineWeek([]), config, aiProvider: "polza" } })).groups.some((g) => g.key === "spend"), false, "за 7 дней расхода нет — блока нет");
});

test("Ф2: признаки по фото — общий потолок не оставил даже на один вызов: «Сборщик стоит — упёрся в общий потолок движка»; остаток потолка меньше очереди — названо", () => {
  const stopped = buildReadiness(input({ traits: traits({ engineCallsLeft: 0 }) }));
  assert.equal(stopped.problem, true);
  assert.match(lines(stopped, "traits"), /Сборщик стоит — упёрся в общий потолок движка \(ASSORTMENT_ENGINE_WEEKLY_BUDGET_USD\): каталоги Zara и Uniqlo в приоритете/);
  const low = buildReadiness(input({ traits: traits({ engineCallsLeft: 10 }) }));
  assert.match(lines(low, "traits"), /Остатка общего потолка движка \(после резерва под каталоги\) хватит примерно на 10 вызовов — меньше очереди/);
  assert.doesNotMatch(lines(buildReadiness(input({ traits: traits({ engineCallsLeft: 100_000 }) })), "traits"), /потолка движка/, "остатка хватает — молчим");
});

test("Ф2: чтение базы — расход движка за 7 дней (скользящая неделя, как у бюджета разбора по фото) одним чтением учёта", async () => {
  const { db } = fakeDb({
    assortment_model_attributes: [attr("ok")],
    assortment_ai_usage: [
      { day: "2026-10-06", kind: "catalog_attributes", calls: 40, cost_usd: 0.07 },
      { day: "2026-10-01", kind: "brightdata:zara", calls: 1200, cost_usd: 3 },
      { day: "2026-09-20", kind: "brightdata:uniqlo", calls: 1200, cost_usd: 3 },
    ],
  });
  const r = await loadReadiness(db, "bags", new Date("2026-10-06T10:00:00Z"), { traits: (async () => report({ analyzed: 1, queue: { queued: 5, exhausted: 0, unstable: 0 } })) as never });
  assert.match(lines(r, "spend"), /Bright Data: Zara \$3,00 — оценка по записям\. Итого \$3,07 из \$30,00\./, "Uniqlo 16-дневной давности в неделю не входит");
  assert.deepEqual(r.errors, []);
  assert.doesNotMatch(lines(r, "traits"), /общий потолок/);
  // Каталоги выбрали неделю ($25 Zara + норма остальных покупок в резерве): у разбора по фото свой бюджет есть, а общий потолок — нет.
  const capped = fakeDb({ assortment_model_attributes: [attr("ok")], assortment_ai_usage: [{ day: "2026-10-06", kind: "catalog_attributes", calls: 40, cost_usd: 0.07 }, { day: "2026-10-05", kind: "brightdata:zara", calls: 10000, cost_usd: 25 }] });
  const rc = await loadReadiness(capped.db, "bags", new Date("2026-10-06T10:00:00Z"), { traits: (async () => report({ analyzed: 1, queue: { queued: 5, exhausted: 0, unstable: 0 } })) as never });
  assert.match(lines(rc, "traits"), /Сборщик стоит — упёрся в общий потолок движка/, "остаток потолка у полоски — тем же правилом, что у сборщика");
});

// --- Ф2 по ревью ---

test("Ф2 по ревью: расход движка не прочитался — строка «не загрузилось» на полоске, блока расхода нет (не тихий ноль); остальные части читаются", async () => {
  // Падает только чтение недели движка (без фильтра по статье); свой бюджет разбора по фото читается.
  const { db } = fakeDb({ assortment_model_attributes: [attr("ok")], assortment_ai_usage: [{ day: "2026-10-06", kind: "catalog_attributes", calls: 40, cost_usd: 0.07 }] }, {
    failIf: (table, filters) => table === "assortment_ai_usage" && !filters.some((f) => f.startsWith("eq:kind")),
  });
  const r = await loadReadiness(db, "bags", new Date("2026-10-06T10:00:00Z"), { traits: (async () => report({ analyzed: 1, queue: { queued: 5, exhausted: 0, unstable: 0 } })) as never });
  assert.ok(r.errors.some((e) => /^расход движка \(учёт расхода движка не прочитался: таймаут запроса\)$/.test(e)), r.errors.join("; "));
  assert.equal(r.groups.some((g) => g.key === "spend"), false);
  assert.ok(r.groups.some((g) => g.key === "traits"), "признаки по фото — на месте");
});

test("Ф2 по ревью: расход движка читается параллельно с остальными частями полоски, а не до них (лишний круг к базе)", async () => {
  const inner = fakeDb({ assortment_model_attributes: [attr("ok")], assortment_ai_usage: [{ day: "2026-10-06", kind: "catalog_attributes", calls: 40, cost_usd: 0.07 }] });
  const order: string[] = [];
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const db = {
    from: (table: string) => {
      order.push(table);
      const q = (inner.db as unknown as { from: (t: string) => Record<string, unknown> }).from(table);
      if (table !== "assortment_ai_usage") return q;
      const then = q.then as (a: unknown, b?: unknown) => Promise<unknown>;
      q.then = (resolve: unknown, reject: unknown) => gate.then(() => then(resolve, reject));
      return q;
    },
  } as never;
  const pending = loadReadiness(db, "bags", new Date("2026-10-06T10:00:00Z"), { traits: (async () => report({ analyzed: 1, queue: { queued: 5, exhausted: 0, unstable: 0 } })) as never });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(order.includes("assortment_model_attributes"), "признаки читаются, пока учёт расхода ещё не ответил");
  release();
  const r = await pending;
  assert.match(lines(r, "spend"), /Итого \$0,07 из \$30,00/);
});
