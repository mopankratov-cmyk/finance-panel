import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { anthropicCallUsd, polzaCallUsd } from "../lib/assortment/aiAttributesStore.ts";
import { BRIGHTDATA_TARGETS, ZARA_PHOTOS } from "../lib/assortment/brightdataCatalog.ts";
import { CATALOG_AI_KIND } from "../lib/assortment/catalogAi.ts";
import { ACCESS_STATUS_LABEL, parseAccessStatus } from "../lib/assortment/constants.ts";
import { effectiveAccessStatus, type AssortmentSource } from "../lib/assortment/coverage.ts";
import {
  addToWeek, brightdataUsd, catalogWeeklyNeedUsd, ENGINE_KIND, engineBudgetConfig, engineRefusal, engineReserveUsd, engineRoomUsd, engineWeek, isEngineKind, kindTier,
  pendingMaxUsd, targetKind, targetMaxUsd, ZARA_PHOTOS_MAX_USD,
} from "../lib/assortment/engineBudget.ts";
import { addEngineUsage, loadEngineWeek } from "../lib/assortment/engineBudgetStore.ts";
import {
  alertIdentity, ASSORTMENT_ALERT_PREFIX, assortmentAlertPlan, assortmentFreshness, assortmentStallTelegram, CLIP_SOURCE_ID, clipFreshness, MINI_SOURCE_IDS, type SourceFact,
} from "../lib/assortment/freshness.ts";
import { loadClipPulse } from "../lib/assortment/freshnessStore.ts";
import { loadFormModelsInfo } from "../lib/assortment/formsStore.ts";
import { COST_PER_REQUEST_USD } from "../lib/assortment/socialReels.ts";
import { brightdataBillingAlarm, jobsAlertPlan, jobsFreshness, type JobRun } from "../lib/assortment/jobsWatch.ts";
import { loadAssortmentSources } from "../lib/assortment/sources.ts";
import { STAGE6_AWAITING_NOTE, STAGE6_AWAITING_OWNER, STAGE6_CONNECTED, STAGE6_SWITCHED_OFF_NOTE } from "../lib/assortment/stage6Sources.ts";
import { SourcesList } from "../components/assortment/SourcesList.tsx";

/**
 * Ф2 (07.10): сквозной учёт расхода движка, общий потолок $30 в неделю с приоритетом каталогов, честные подписи источников Этапа 6,
 * сторож mini (одна тревога за простой, пульс CLIP) и хвосты аудита (постраничное чтение голов).
 */

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(join(root, path), "utf8");
const DAY = 24 * 3600 * 1000;
const HOUR = 3600 * 1000;
const NOW = Date.parse("2026-10-07T09:30:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const ENGINE = { weeklyUsd: 30, socialWeeklyUsd: 3 };

// --- статьи, цены, норма каталогов ---

test("Статьи расхода: бренд и часть раздела Bright Data, фото Zara, рилсы, разбор по фото, старый разбор находок; замки и чужие назначения — не движок", () => {
  assert.deepEqual([...new Set(BRIGHTDATA_TARGETS.map((t) => targetKind(t)))].sort(), [
    "brightdata:asos", "brightdata:hm", "brightdata:uniqlo", "brightdata:uniqlo_collab", "brightdata:zara", "brightdata:zara_chaqueta",
  ], "у каждой цели — своя статья, без «неизвестной»");
  assert.equal(CATALOG_AI_KIND, ENGINE_KIND.catalogAi, "одна статья разбора по фото: и у сборщика, и в учёте движка");
  for (const kind of ["catalog_attributes", "reference_ai", "brightdata_social", "social_attributes", "brightdata:zara", "brightdata:zara_photos"]) assert.ok(isEngineKind(kind), kind);
  for (const kind of ["lock:catalog_attributes", "lock:brightdata_social", "other_ai", ""]) assert.equal(isEngineKind(kind), false, kind);
  assert.deepEqual(["brightdata:zara", "brightdata:uniqlo", "brightdata:zara_chaqueta", "brightdata:asos", "brightdata:zara_photos", "catalog_attributes", "brightdata_social", "reference_ai"].map(kindTier), [0, 0, 1, 1, 1, 2, 2, 2],
    "Zara и Uniqlo по средам отказывают последними, рилсы и разбор по фото — первыми");
});

test("Цены Bright Data — оценка с пометкой: наборы $2,5 за 1 000 записей, сборщики $1,5, Web Unlocker $1,5 за 1 000 запросов (та же цена у рилсов); запуск сверху — по потолку записей", () => {
  assert.equal(brightdataUsd(1000, "dataset"), 2.5);
  assert.equal(brightdataUsd(1000, "collector"), 1.5);
  assert.equal(brightdataUsd(1000, "unlocker"), 1.5);
  assert.equal(COST_PER_REQUEST_USD, 0.0015, "рилсы считают по той же цене");
  const engineSource = read("lib/assortment/engineBudget.ts");
  assert.match(engineSource, /Цены Bright Data, \$ за 1 000 — ОЦЕНКА/, "пометка «оценка» у цен");
  const zaraJackets = BRIGHTDATA_TARGETS.find((t) => t.sourceId === "S001" && t.direction === "jackets" && !t.part)!;
  assert.equal(targetMaxUsd(zaraJackets), 2.5, "1 000 записей набора");
  const hm = BRIGHTDATA_TARGETS.find((t) => t.sourceId === "S007")!;
  assert.equal(targetMaxUsd(hm), brightdataUsd(25, "collector"), "у сборщика — как ограничивает сам вызов: limit_per_input не больше 25");
  assert.equal(ZARA_PHOTOS_MAX_USD, brightdataUsd(ZARA_PHOTOS.recordsLimit, "dataset"));
  // Норма каталогов на неделю (оценка сверху): Zara и Uniqlo — $5, остальные покупки — $4,95; разбору по фото при пустой неделе остаётся ≈$20.
  const need = catalogWeeklyNeedUsd();
  const tier = (t: number) => Math.round(Object.entries(need).filter(([k]) => kindTier(k) === t).reduce((s, [, v]) => s + v, 0) * 100) / 100;
  assert.deepEqual([tier(0), tier(1)], [5, 4.95]);
  assert.equal(engineRoomUsd(engineWeek([]), CATALOG_AI_KIND, ENGINE), 20.05);
  assert.equal(pendingMaxUsd({ kind: "dataset", recordsLimit: 300, datasetId: "gd_x", direction: "bags" }), 0.75);
});

test("Настройки: ASSORTMENT_ENGINE_WEEKLY_BUDGET_USD (по умолчанию 30) и ASSORTMENT_SOCIAL_WEEKLY_USD (по умолчанию 3); ноль — стоп, мусор — по умолчанию", () => {
  assert.deepEqual(engineBudgetConfig({}), { weeklyUsd: 30, socialWeeklyUsd: 3 });
  assert.deepEqual(engineBudgetConfig({ ASSORTMENT_ENGINE_WEEKLY_BUDGET_USD: "0", ASSORTMENT_SOCIAL_WEEKLY_USD: "1.5" }), { weeklyUsd: 0, socialWeeklyUsd: 1.5 });
  assert.deepEqual(engineBudgetConfig({ ASSORTMENT_ENGINE_WEEKLY_BUDGET_USD: "-5", ASSORTMENT_SOCIAL_WEEKLY_USD: "abc" }), { weeklyUsd: 30, socialWeeklyUsd: 3 });
  assert.equal(engineRoomUsd(engineWeek([]), "brightdata:zara", { weeklyUsd: 0, socialWeeklyUsd: 3 }), 0, "потолок 0 — платить нельзя никому");
});

test("Приоритет каталогов: ярус тратит только то, что осталось после невыбранной нормы ярусов выше; у рилсов — ещё и своя строка", () => {
  const week = engineWeek([{ kind: "catalog_attributes", cost_usd: 20 }, { kind: "brightdata_social", cost_usd: 2 }]);
  const need = catalogWeeklyNeedUsd();
  assert.equal(engineReserveUsd(week, 0, need), 0, "у Zara и Uniqlo резерва над ними нет");
  assert.equal(engineReserveUsd(week, 1, need), 5);
  assert.equal(engineReserveUsd(week, 2, need), 9.95);
  assert.deepEqual([engineRoomUsd(week, "brightdata:zara", ENGINE, need), engineRoomUsd(week, "brightdata:asos", ENGINE, need), engineRoomUsd(week, CATALOG_AI_KIND, ENGINE, need)], [8, 3, 0]);
  // Купили Zara — её норма выбрана: резерв ниже уменьшился ровно на её стоимость.
  const bought = addToWeek(week, "brightdata:zara", 2.5);
  assert.equal(engineReserveUsd(bought, 2, need), 7.45);
  assert.equal(engineRoomUsd(bought, CATALOG_AI_KIND, ENGINE, need), 0);
  // Строка соцсетей: $3 в неделю — потрачено $2, остаётся $1, хотя общий потолок шире.
  const socialOnly = engineWeek([{ kind: "brightdata_social", cost_usd: 2 }]);
  assert.equal(engineRoomUsd(socialOnly, ENGINE_KIND.social, ENGINE, need), 1);
  assert.match(String(engineRefusal(socialOnly, ENGINE_KIND.social, 1.5, ENGINE, need)), /строка соцсетей \$3,00 в неделю выбрана \(\$2,00\)/);
  assert.equal(engineRefusal(week, "brightdata:zara", 2.5, ENGINE, need), null, "помещается — причины нет");
  assert.match(String(engineRefusal(week, "brightdata:asos", 3.5, ENGINE, need)), /^общий потолок движка: запуск ≈\$3,50 \(оценка\) не помещается в остаток \$3,00 — за 7 дней \$22,00 из \$30,00, под каталоги отложено \$5,00$/);
});

// --- учёт: чтение недели и запись ---

type Row = Record<string, unknown>;
const POSTGREST_MAX_ROWS = 1000;
/** Подставная база: фильтры eq / gte / in / is / not is null, порядок, окно range (не больше 1 000 строк), insert, update … select, maybeSingle. */
function memoryDb(tables: Record<string, Row[]>, opts: { missing?: string[]; fail?: string[] } = {}) {
  const db = {
    from: (table: string) => {
      const filters: Array<(r: Row) => boolean> = [];
      let op: "select" | "update" = "select";
      let values: Row = {};
      let returning = false;
      let sort: { col: string; asc: boolean } | null = null;
      let max = Infinity;
      const err = opts.missing?.includes(table) ? { code: "42P01", message: `relation "public.${table}" does not exist` } : opts.fail?.includes(table) ? { message: "таймаут запроса" } : null;
      const rows = () => {
        let list = (tables[table] ??= []).filter((r) => filters.every((f) => f(r)));
        if (sort) {
          const { col, asc } = sort;
          list = list.slice().sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (asc ? 1 : -1));
        }
        return list;
      };
      const exec = (from = 0, to = Infinity) => {
        if (err) return { data: null, error: err };
        if (op === "update") {
          const hit = rows();
          for (const r of hit) Object.assign(r, values);
          return { data: returning ? hit.map((r) => ({ ...r })) : null, error: null };
        }
        return { data: rows().slice(from, Math.min(to + 1, from + POSTGREST_MAX_ROWS, max)).map((r) => ({ ...r })), error: null };
      };
      const q: Record<string, unknown> = {
        select: () => { if (op === "update") returning = true; return q; },
        eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q; },
        gte: (c: string, v: unknown) => { filters.push((r) => r[c] != null && String(r[c]) >= String(v)); return q; },
        gt: (c: string, v: unknown) => { filters.push((r) => r[c] != null && Number(r[c]) > Number(v)); return q; },
        contains: (c: string, vs: unknown[]) => { filters.push((r) => Array.isArray(r[c]) && vs.every((v) => (r[c] as unknown[]).includes(v))); return q; },
        in: (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return q; },
        is: (c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return q; },
        not: (c: string, operator: string, v: unknown) => { assert.equal(`${operator} ${v}`, "is null"); filters.push((r) => r[c] != null); return q; },
        order: (col: string, o?: { ascending?: boolean }) => { if (!sort) sort = { col, asc: o?.ascending !== false }; return q; },
        limit: (n: number) => { max = n; return q; },
        range: (a: number, b: number) => Promise.resolve(exec(a, b)),
        maybeSingle: () => { const res = exec(); return Promise.resolve(res.error ? res : { data: (res.data as Row[])[0] ?? null, error: null }); },
        update: (v: Row) => { op = "update"; values = v; return q; },
        insert: (row: Row) => {
          if (err) return Promise.resolve({ error: err });
          const list = (tables[table] ??= []);
          if (table === "assortment_ai_usage" && list.some((r) => r.day === row.day && r.kind === row.kind)) return Promise.resolve({ error: { code: "23505", message: "duplicate key" } });
          list.push({ ...row });
          return Promise.resolve({ error: null });
        },
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(exec()).then(resolve, reject),
      };
      return q;
    },
  };
  return db as never;
}

test("Учёт недели: скользящие 7 московских суток, только статьи движка; нет таблицы — null (решает вызывающий); сбой чтения — исключение, не «ноль»", async () => {
  const usage: Row[] = [
    { day: "2026-10-07", kind: "catalog_attributes", cost_usd: 1.2 }, { day: "2026-10-01", kind: "brightdata:zara", cost_usd: "2.5" },
    { day: "2026-09-30", kind: "brightdata:uniqlo", cost_usd: 1 }, { day: "2026-10-05", kind: "lock:catalog_attributes", cost_usd: 0 }, { day: "2026-10-06", kind: "other_ai", cost_usd: 99 },
  ];
  const week = await loadEngineWeek(memoryDb({ assortment_ai_usage: usage }), NOW);
  assert.deepEqual(week, { byKind: { catalog_attributes: 1.2, "brightdata:zara": 2.5 }, total: 3.7 }, "30.09 — уже за неделей; замок и чужое назначение — мимо");
  assert.equal(await loadEngineWeek(memoryDb({}, { missing: ["assortment_ai_usage"] }), NOW), null);
  await assert.rejects(loadEngineWeek(memoryDb({}, { fail: ["assortment_ai_usage"] }), NOW), /учёт расхода движка не прочитался: таймаут запроса/);
});

test("Запись расхода статьи: строка на день и статью, прибавляется (а не затирается); без таблицы — тихо; пустое — не пишется", async () => {
  const tables: Record<string, Row[]> = { assortment_ai_usage: [] };
  const db = memoryDb(tables);
  await addEngineUsage(db, NOW, "brightdata:zara", { calls: 120, costUsd: 0.3 });
  await addEngineUsage(db, NOW, "brightdata:zara", { calls: 80, costUsd: 0.2 });
  await addEngineUsage(db, NOW, "reference_ai", { calls: 1, inputTokens: 900, outputTokens: 120, costUsd: 0.0075 });
  await addEngineUsage(db, NOW, "brightdata:asos", { calls: 0, costUsd: 0 });
  assert.deepEqual(tables.assortment_ai_usage.map((r) => [r.day, r.kind, r.calls, r.cost_usd]), [["2026-10-07", "brightdata:zara", 200, 0.5], ["2026-10-07", "reference_ai", 1, 0.0075]]);
  assert.equal(tables.assortment_ai_usage[1].input_tokens, 900);
  await addEngineUsage(memoryDb({}, { missing: ["assortment_ai_usage"] }), NOW, "brightdata:zara", { calls: 1, costUsd: 0.0025 });
});

test("Старый разбор находок — только учёт (провайдер прежний): Polza — списанные рубли по курсу (факт), Anthropic — токены по цене модели; ответ записывается в статью reference_ai сразу после вызова", () => {
  assert.equal(polzaCallUsd({ cost_rub: 1.6 }, 80), 0.02);
  assert.equal(polzaCallUsd({ cost: "0.8" }, 80), 0.01);
  assert.equal(polzaCallUsd(undefined, 80), 0, "суммы нет — не придумываем");
  assert.equal(anthropicCallUsd("claude-opus-5", 4000, 600), 0.035);
  assert.equal(anthropicCallUsd("claude-unknown", 4000, 600), 0.035, "неизвестная модель — по цене Opus 5 (оценка сверху)");
  const store = read("lib/assortment/aiAttributesStore.ts");
  assert.match(store, /const answer = await askModel\(direction, imageUrls\);\s*await addEngineUsage\(db, Date\.now\(\), ENGINE_KIND\.referenceAi,/, "расход — сразу после ответа, до разбора и записи признаков");
  assert.match(store, /POLZA_MODEL \|\| "openai\/gpt-4o"/, "провайдер и модель старого разбора не менялись");
  assert.match(read("app/api/sync/assortment-ai-attributes/route.ts"), /estimateAttributes\(db, id, \{ onUsageError: /, "сбой записи учёта — в журнал крона");
});

// --- честные подписи источников Этапа 6 ---

const passport = (sourceId: string, accessStatus: AssortmentSource["accessStatus"] = "untested", over: Partial<AssortmentSource> = {}) => ({ sourceId, accessStatus, accessNote: "Документация проверена; ключ не тестировался", lastSuccessAt: null, ...over });

test("Этап 6: S067, S069–S083 — «Не подключено: ждёт решения владельца» вместо «Доступ не проверен»; S068 (рилсы) — подключён: «Автосбор проверен» по удачному прогону крона, без него — «Частично»; подпись в коде, без UPDATE паспорта", () => {
  const ids = Array.from({ length: 17 }, (_, i) => `S0${67 + i}`);
  assert.deepEqual([...STAGE6_AWAITING_OWNER].sort(), ids.filter((id) => id !== "S068"));
  for (const id of STAGE6_AWAITING_OWNER) assert.equal(effectiveAccessStatus(passport(id), NOW), "not_connected", id);
  assert.equal(ACCESS_STATUS_LABEL.not_connected, "Не подключено: ждёт решения владельца");
  assert.equal(effectiveAccessStatus(passport("S068", "untested", { lastSuccessAt: ago(20 * HOUR) }), NOW), "auto_verified");
  assert.equal(effectiveAccessStatus(passport("S068", "untested", { lastSuccessAt: ago(3 * DAY) }), NOW), "partial", "крон молчит трое суток — не «работает»");
  // Крон каждые 3 часа: «работает» — удачный прогон с работой за полтора дня (сутки с запасом на день без работы), а не 2,5 суток.
  assert.equal(effectiveAccessStatus(passport("S068", "untested", { lastSuccessAt: ago(30 * HOUR) }), NOW), "auto_verified");
  assert.equal(effectiveAccessStatus(passport("S068", "untested", { lastSuccessAt: ago(40 * HOUR) }), NOW), "partial", "40 часов без работы при кроне раз в 3 часа — не «работает»");
  assert.match(STAGE6_CONNECTED.S068.note, /крон каждые 3 часа/);
  assert.doesNotMatch(STAGE6_CONNECTED.S068.note, /ежедневно/);
  assert.equal(effectiveAccessStatus(passport("S068"), NOW), "partial");
  assert.equal(effectiveAccessStatus(passport("S067", "disabled"), NOW), "disabled", "отключённый владельцем остаётся отключённым");
  assert.ok(ids.every((id) => effectiveAccessStatus(passport(id), NOW) !== "untested"), "ни у одной соцстроки нет «Доступ не проверен»");
  assert.equal(effectiveAccessStatus(passport("S084"), NOW), "untested", "Google Lens — не Этап 6 соцсетей: как было");
  assert.equal(STAGE6_CONNECTED.S068.job, "assortment-social");
  // Экран: подпись видна, в паспорт ничего не пишется.
  const html = renderToStaticMarkup(createElement(SourcesList, { sources: [{ sourceId: "S069", name: "TikTok", group: null, categories: ["bags"], region: null, priority: null, adapterType: null, accessStatus: "not_connected", accessNote: null, lastSuccessAt: null, lastAttemptAt: null, lastError: null }] }));
  assert.match(html, /Не подключено: ждёт решения владельца/);
  const sources = read("lib/assortment/sources.ts");
  assert.doesNotMatch(sources, /\.update\(|\.upsert\(|\.insert\(/, "загрузчик паспорта только читает");
  assert.equal(parseAccessStatus("untested"), "untested");
});

// --- сторож mini ---

const fact = (sourceId: string, over: Partial<SourceFact> = {}): SourceFact => ({ sourceId, name: sourceId, lastAttemptAt: ago(HOUR), lastSuccessAt: ago(HOUR), lastError: null, ...over });

test("Сторож mini: всё, что приносит Mac mini (магазины РФ через mini, Zalando, отпечатки CLIP), — одна тревога за один простой: источники замолкают по очереди, сообщение одно", () => {
  for (const id of ["S131", "S132", "S133", "S134", "S136", "S137", "S138", "S139", "S140", CLIP_SOURCE_ID]) assert.ok(MINI_SOURCE_IDS.has(id), id);
  for (const id of ["S130", "S135", "S001", "S014"]) assert.equal(MINI_SOURCE_IDS.has(id), false, `${id} — не mini (облако)`);
  assert.equal(alertIdentity("S131", true), "mini", "простой mini — одна причина");
  assert.equal(alertIdentity("S131", false), "S131", "один сайт через mini — своя причина");
  // День 1: молчит Zalando (порог 5,5 сут) и CLIP; день 3: ещё befree и Sela — набор молчунов другой, а тревога та же.
  const clipDown = { lastEmbeddingAt: ago(3 * DAY), oldestWaitingAt: ago(2 * DAY) };
  const day1 = assortmentFreshness([fact("S138", { lastSuccessAt: ago(6 * DAY) }), fact("S014")], NOW, clipDown);
  const first = assortmentAlertPlan(day1, []);
  assert.equal(first.send, "stalled");
  assert.equal(first.openKey, `${ASSORTMENT_ALERT_PREFIX}mini`);
  const day3 = assortmentFreshness([fact("S138", { lastSuccessAt: ago(8 * DAY) }), fact("S131", { lastSuccessAt: ago(6 * DAY) }), fact("S134", { lastSuccessAt: ago(6 * DAY) }), fact("S014")], NOW, clipDown);
  assert.equal(day3.stalled.length, 4);
  assert.equal(assortmentAlertPlan(day3, [first.openKey!]).send, null, "тот же простой mini — без нового сообщения");
  const text = assortmentStallTelegram(day3);
  assert.equal((text.match(/^• /gm) ?? []).length, 1, "одна строка на mini");
  assert.match(text, /• Mac mini — молчат 4: Отпечатки фото \(CLIP на Mac mini\)/);
  // Замолчал облачный источник — это другая причина: новое сообщение.
  const plusCloud = assortmentFreshness([fact("S138", { lastSuccessAt: ago(8 * DAY) }), fact("S014", { lastSuccessAt: ago(4 * DAY) })], NOW, clipDown);
  assert.equal(assortmentAlertPlan(plusCloud, [first.openKey!]).openKey, `${ASSORTMENT_ALERT_PREFIX}S014,mini`);
  // mini ожил — «снова идёт».
  assert.equal(assortmentAlertPlan(assortmentFreshness([fact("S138"), fact("S014")], NOW, { lastEmbeddingAt: ago(HOUR), oldestWaitingAt: null }), [first.openKey!]).send, "recovered");
});

test("Пульс CLIP: простой — фото в очереди ждут дольше суток и нового отпечатка за сутки не было; пустая очередь или свежее фото — не простой", () => {
  assert.equal(clipFreshness({ lastEmbeddingAt: ago(3 * DAY), oldestWaitingAt: ago(30 * HOUR) }, NOW).state, "stalled");
  assert.equal(clipFreshness({ lastEmbeddingAt: null, oldestWaitingAt: ago(30 * HOUR) }, NOW).state, "stalled", "отпечатков не было вовсе");
  assert.equal(clipFreshness({ lastEmbeddingAt: ago(3 * DAY), oldestWaitingAt: null }, NOW).state, "ok", "считать нечего — mini не судим");
  assert.equal(clipFreshness({ lastEmbeddingAt: ago(3 * DAY), oldestWaitingAt: ago(10 * 60 * 1000) }, NOW).state, "ok", "фото только что пришло: сборщик возьмёт его в ближайшие 15 минут");
  assert.equal(clipFreshness({ lastEmbeddingAt: ago(2 * HOUR), oldestWaitingAt: ago(30 * HOUR) }, NOW).state, "ok", "отпечатки идут — очередь просто длинная");
  assert.equal(clipFreshness({ lastEmbeddingAt: null, oldestWaitingAt: null }, NOW).state, "awaiting");
  assert.equal(clipFreshness({ lastEmbeddingAt: ago(3 * DAY), oldestWaitingAt: ago(30 * HOUR) }, NOW).silentDays, 3);
});

test("Пульс CLIP из базы: последний отпечаток (и с ошибкой фото — mini жив) и самое старое фото очереди; таблиц нет или сбой — null, сторож источников работает как раньше", async () => {
  const db = memoryDb({
    assortment_media_embeddings: [{ media_id: "m1", created_at: ago(3 * DAY) }, { media_id: "m2", created_at: ago(2 * DAY), error: "фото не прочиталось" }],
    assortment_embedding_queue: [{ media_id: "m3" }, { media_id: "m4" }],
    assortment_media: [{ id: "m3", created_at: ago(5 * HOUR) }, { id: "m4", created_at: ago(30 * HOUR) }, { id: "m9", created_at: ago(90 * DAY) }],
  });
  assert.deepEqual(await loadClipPulse(db), { lastEmbeddingAt: ago(2 * DAY), oldestWaitingAt: ago(30 * HOUR) });
  assert.deepEqual(await loadClipPulse(memoryDb({ assortment_media_embeddings: [], assortment_embedding_queue: [] })), { lastEmbeddingAt: null, oldestWaitingAt: null });
  assert.equal(await loadClipPulse(memoryDb({}, { missing: ["assortment_embedding_queue"] })), null);
  const route = read("app/api/sync/assortment-freshness/route.ts");
  assert.match(route, /assortmentFreshness\(facts, startedAt\.getTime\(\), await loadClipPulse\(db\), \{ brightdataBillingAlarmed \}\)/);
});

// --- хвосты аудита ---

test("Загрузчики голов читают больше 1 000 строк целиком (PostgREST режет выборку на 1 000): «Формы» по виду голов и по строкам каталога", async () => {
  const seen = ago(DAY);
  const heads = Array.from({ length: 2_345 }, (_, i) => ({ source_id: `S00${1 + (i % 3)}`, source_item_id: `m${String(i).padStart(5, "0")}`, title: `Jacket ${i}`, direction: "jackets", model_last_seen_at: seen, model_hidden_at: null }));
  const probe = await (memoryDb({ assortment_catalog_heads: heads }) as unknown as { from: (t: string) => { range: (a: number, b: number) => Promise<{ data: unknown[] }> } }).from("assortment_catalog_heads").range(0, 5000);
  assert.equal(probe.data.length, 1_000, "подставная база режет как боевая");
  const viaHeads = await loadFormModelsInfo(memoryDb({ assortment_catalog_heads: heads, assortment_sources: [] }), "jackets", NOW);
  assert.equal(viaHeads.viaHeads, true);
  assert.equal(viaHeads.models.length, 2_345, "все модели, а не первая тысяча");
  const items = heads.map((h) => ({ source_id: h.source_id, source_item_id: h.source_item_id, title: h.title, direction: "jackets", last_seen_at: seen }));
  const viaItems = await loadFormModelsInfo(memoryDb({ assortment_source_items: items, assortment_sources: [] }, { missing: ["assortment_catalog_heads"] }), "jackets", NOW);
  assert.equal(viaItems.viaHeads, false);
  assert.equal(viaItems.models.length, 2_345);
});

test("Страница листания нигде в модуле не больше 1 000 строк: при pageSize больше предела PostgREST первая же страница «короткая», и чтение молча обрывается на тысяче", () => {
  const files = [
    ...readdirSync(join(root, "lib/assortment")).filter((f) => f.endsWith(".ts")).map((f) => `lib/assortment/${f}`),
    "app/api/assortment-development/own-models/route.ts",
  ];
  const offenders = files.flatMap((path) => [...read(path).matchAll(/pageSize:\s*([\d_]+)/g)].map((m) => [path, Number(m[1].replace(/_/g, ""))] as const)).filter(([, n]) => n > 1000);
  assert.deepEqual(offenders, []);
});

test("feed.ts читает строки по списку находок общим rowsByIds (пачки, листание, пул), а не своей копией", () => {
  const feed = read("lib/assortment/feed.ts");
  assert.match(feed, /import \{ rowsByIds \} from "\.\/byIds";/);
  assert.doesNotMatch(feed, /rowsByReferences|REF_CHUNK|loadAllSupabasePages/);
  assert.equal((feed.match(/rowsByIds</g) ?? []).length, 2, "наблюдения и фото находок");
});

test("Документация §14 называет Ф2: переменные потолка, статьи учёта, пометку «оценка» у цен Bright Data, «нет денег» одной тревогой, сторож mini и подписи Этапа 6", () => {
  const docs = read("docs/assortment-development-integration.md").replace(/\s+/g, " ");
  for (const probe of [
    /`ASSORTMENT_ENGINE_WEEKLY_BUDGET_USD` \(по умолчанию 30/, /`ASSORTMENT_SOCIAL_WEEKLY_USD` \(по умолчанию 3/, /\*\*оценка\*\*, владелец один раз сверяет с кабинетом/,
    /`brightdata:zara \| zara_chaqueta \| zara_photos \| uniqlo \| uniqlo_collab \| asos \| hm`/, /`reference_ai` — старый разбор находок/,
    /один ключ `billing:brightdata`, без потока сообщений/, /ключ тревоги у них общий \(`mini`\)/, /S067 и S069–S083 — «Не подключено: ждёт решения владельца»/,
  ]) assert.match(docs, probe);
});

// --- Ф2 по ревью ---

/** Паспорт Этапа 6, как его засеяла миграция этапа 0 (подписи — дословно из seed). */
const seedRow = (source_id: string, name: string, access_note: string, over: Row = {}): Row => ({
  source_id, name, source_group: "Соцсети и образы", categories: ["jackets", "bags"], region: null, priority: "P0", adapter_type: "C2 Social", access_status: "untested", access_note,
  last_success_at: null, last_attempt_at: null, last_error: null, ...over,
});
const STAGE6_SEED = [
  seedRow("S067", "Pinterest Pins", "Кандидат; доступ не проверен"),
  seedRow("S068", "Instagram Reels", "Официальная коллекция найдена; операции требуют пилота"),
  seedRow("S069", "TikTok", "Документация проверена; ключ не тестировался"),
  seedRow("S078", "LTK", "Кандидат; доступ не проверен"),
  seedRow("S083", "Яндекс Wordstat", "Документация проверена; ключ не тестировался"),
  seedRow("S082", "Baidu Index", "Кандидат; доступ не проверен", { access_status: "disabled", access_note: "Отключён владельцем" }),
];
const socialRun = (status: string, rows: number | null, hoursAgo: number, error: string | null = null): Row => ({ job: "assortment-social", status, rows_affected: rows, error, started_at: ago(hoursAgo * HOUR) });
const loadSources = (syncLog: Row[], over: { socialEnabled?: boolean } = {}) =>
  loadAssortmentSources(null, { db: memoryDb({ assortment_sources: STAGE6_SEED.map((r) => ({ ...r })), sync_log: syncLog }), now: NOW, socialEnabled: over.socialEnabled ?? true });

test("Ф2 по ревью: Этап 6 через загрузчик паспорта — у S067, S069–S083 вместо записи паспорта («Кандидат; доступ не проверен») подпись «ждёт решения владельца»; у S068 нет «В паспорте записано: доступ не проверен»", async () => {
  const result = await loadSources([socialRun("ok", 14, 20)]);
  assert.ok(result.ok);
  const byId = Object.fromEntries(result.sources.map((src) => [src.sourceId, src]));
  for (const id of ["S067", "S069", "S078", "S083"]) {
    assert.deepEqual([byId[id].accessStatus, byId[id].accessNote, byId[id].declaredAccessStatus], ["not_connected", STAGE6_AWAITING_NOTE, undefined], id);
  }
  assert.deepEqual([byId.S082.accessStatus, byId.S082.accessNote], ["disabled", "Отключён владельцем"], "отключённый владельцем — как записано");
  assert.deepEqual([byId.S068.accessStatus, byId.S068.declaredAccessStatus, byId.S068.accessNote], ["auto_verified", undefined, STAGE6_CONNECTED.S068.note]);
  const html = renderToStaticMarkup(createElement(SourcesList, { sources: result.sources }));
  assert.doesNotMatch(html, /доступ не проверен|ключ не тестировался|В паспорте записано/i, "doneWhen: ни у одной соцстроки нет «Доступ не проверен»");
  assert.match(html, /Не подключено: ждёт решения владельца/);
});

test("Ф2 по ревью: пульс S068 — только прогон крона рилсов, который действительно собирал: выключенный крон (ASSORTMENT_SOCIAL=off пишет «ok» с нулём), прогон без запросов и прогон с ошибкой — не «Автосбор проверен»; выключен — «Отключён»", async () => {
  const status = async (log: Row[], over: { socialEnabled?: boolean } = {}) => {
    const result = await loadSources(log, over);
    assert.ok(result.ok);
    return result.sources.find((src) => src.sourceId === "S068")!;
  };
  assert.equal((await status([socialRun("ok", 0, 2, "выключено (ASSORTMENT_SOCIAL=off)")])).accessStatus, "partial", "строка выключенного крона — не пульс");
  assert.equal((await status([socialRun("partial", 0, 2, "упёрлись в общий потолок движка")])).accessStatus, "partial", "потолок не дал ни одного запроса — не пульс");
  assert.equal((await status([socialRun("error", 7, 2, "вёрстка Instagram изменилась")])).accessStatus, "partial", "прогон с ошибкой — не пульс");
  assert.equal((await status([socialRun("ok", 0, 2), socialRun("partial", 5, 30)])).accessStatus, "auto_verified", "последний прогон с работой — 30 часов назад");
  assert.equal((await status([socialRun("ok", 5, 70)])).accessStatus, "partial", "крон молчит дольше двух с половиной суток");
  const off = await status([socialRun("ok", 12, 2)], { socialEnabled: false });
  assert.deepEqual([off.accessStatus, off.accessNote], ["disabled", STAGE6_SWITCHED_OFF_NOTE]);
});

test("Ф2 по ревью: пульс Этапа 6 читается вместе с паспортом, а не после него (лишний круг к базе)", async () => {
  const order: string[] = [];
  const inner = memoryDb({ assortment_sources: STAGE6_SEED.map((r) => ({ ...r })), sync_log: [socialRun("ok", 3, 2)] }) as unknown as { from: (t: string) => Record<string, unknown> };
  let releasePassport: () => void = () => undefined;
  const passportGate = new Promise<void>((resolve) => { releasePassport = resolve; });
  const db = {
    from: (table: string) => {
      order.push(`from:${table}`);
      const q = inner.from(table);
      if (table !== "assortment_sources") return q;
      const thenable: Record<string, unknown> = { ...q };
      thenable.select = () => thenable;
      thenable.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => passportGate.then(() => (q.then as (a: unknown, b: unknown) => Promise<unknown>)(resolve, reject));
      return thenable;
    },
  } as never;
  const pending = loadAssortmentSources(null, { db, now: NOW, socialEnabled: true });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(order.includes("from:sync_log"), "журнал рилсов запрошен, пока паспорт ещё читается");
  releasePassport();
  const result = await pending;
  assert.ok(result.ok);
  assert.equal(result.sources.find((src) => src.sourceId === "S068")!.accessStatus, "auto_verified");
});

test("Ф2 по ревью: сторож mini — долгая поломка одного сайта «через mini» не глушит тревогу о следующем простое самой mini", () => {
  const MINI = ["S131", "S132", "S133", "S134", "S136", "S137", "S138", "S139", "S140"];
  // befree (S136) сменил разметку: mini жива, молчит один сайт — тревога по его коду, строкой сайта, а не «Mac mini».
  const one = assortmentFreshness([...MINI.map((id) => fact(id, id === "S136" ? { lastSuccessAt: ago(6 * DAY), lastError: "0 карточек" } : {})), fact("S014")], NOW, { lastEmbeddingAt: ago(HOUR), oldestWaitingAt: null });
  const first = assortmentAlertPlan(one, []);
  assert.deepEqual([first.send, first.openKey], ["stalled", `${ASSORTMENT_ALERT_PREFIX}S136`]);
  assert.doesNotMatch(assortmentStallTelegram(one), /Mac mini — молчат/);
  // Через неделю mini выключилась: молчат все магазины РФ, Zalando и отпечатки — это новая причина и новое сообщение.
  const down = assortmentFreshness([...MINI.map((id) => fact(id, { lastSuccessAt: ago(7 * DAY) })), fact("S014")], NOW, { lastEmbeddingAt: ago(6 * DAY), oldestWaitingAt: ago(5 * DAY) });
  const second = assortmentAlertPlan(down, [first.openKey!]);
  assert.deepEqual([second.send, second.openKey, second.resolveKeys], ["stalled", `${ASSORTMENT_ALERT_PREFIX}mini`, [first.openKey]]);
  assert.match(assortmentStallTelegram(down), /• Mac mini — молчат 10:/);
  // Два сайта mini без CLIP (очередь пуста) — тоже простой машины.
  const two = assortmentFreshness([fact("S131", { lastSuccessAt: ago(6 * DAY) }), fact("S132", { lastSuccessAt: ago(6 * DAY) })], NOW, { lastEmbeddingAt: ago(DAY), oldestWaitingAt: null });
  assert.equal(assortmentAlertPlan(two, []).openKey, `${ASSORTMENT_ALERT_PREFIX}mini`);
});

test("Ф2 по ревью: одна остановка Bright Data по деньгам — одно сообщение: источники, молчащие из-за неё, сторож источников не называет, пока держится тревога задач", () => {
  const why = "Bright Data: не куплено: Bright Data — нет денег или аккаунт не активен (402): Customer is not active";
  const facts = (day: string): SourceFact[] => [
    { sourceId: "S001", name: "Zara", lastAttemptAt: `${day}T05:00:00Z`, lastSuccessAt: "2026-10-07T06:30:00Z", lastError: why },
    { sourceId: "S003", name: "Uniqlo", lastAttemptAt: `${day}T05:00:00Z`, lastSuccessAt: "2026-10-07T06:30:00Z", lastError: why },
    { sourceId: "S046", name: "ASOS", lastAttemptAt: `${day}T05:00:00Z`, lastSuccessAt: "2026-10-10T06:30:00Z", lastError: why },
    { sourceId: "S007", name: "H&M", lastAttemptAt: `${day}T05:00:00Z`, lastSuccessAt: "2026-10-10T06:30:00Z", lastError: why },
  ];
  const runs: JobRun[] = [{ job: "assortment-brightdata-trigger", status: "error", error: `${why} — платные покупки остановлены (S046, S001, S003, S007) [stop:billing]`, started_at: "2026-10-14T05:00:00Z", rows_affected: 0 }];
  const messages: string[] = [];
  let jobsOpen: string[] = [];
  let sourcesOpen: string[] = [];
  // Как роут сторожа: журнал задач — до сторожа источников.
  const day = (iso: string, log: JobRun[]) => {
    const now = Date.parse(`${iso}T09:30:00Z`);
    const jobs = jobsFreshness(log, now);
    const sources = assortmentFreshness(facts(iso), now, null, { brightdataBillingAlarmed: brightdataBillingAlarm(jobs) });
    const sp = assortmentAlertPlan(sources, sourcesOpen);
    if (sp.send) messages.push(`${iso} sources:${sp.send}`);
    sourcesOpen = sp.openKey ? [sp.openKey] : [];
    const jp = jobsAlertPlan(jobs, jobsOpen);
    if (jp.send) messages.push(`${iso} jobs:${jp.send}`);
    jobsOpen = jp.openKey ? [jp.openKey] : [];
    return sources;
  };
  for (const iso of ["2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17"]) {
    const sources = day(iso, runs);
    if (iso === "2026-10-17") assert.deepEqual((sources.billingCovered ?? []).map((s) => s.sourceId), ["S001", "S003", "S007", "S046"], "молчат по деньгам — названы тревогой задач");
  }
  assert.deepEqual(messages, ["2026-10-14 jobs:stalled"], "одна причина — одно сообщение");
  // Тревогу задач сняла удачная покупка, а источники всё ещё молчат с той же записью — судим их как всех: сообщение будет.
  const paidAgain: JobRun = { job: "assortment-social", status: "ok", error: null, started_at: "2026-10-18T06:20:00Z", rows_affected: 9 };
  day("2026-10-18", [...runs, paidAgain]);
  assert.deepEqual(messages.slice(1), ["2026-10-18 sources:stalled", "2026-10-18 jobs:recovered"]);
});

test("Ф2 по ревью: метка [stop:billing] — остановка, только когда прогон закончился ошибкой: в тексте удачного прогона она ничего не значит", () => {
  const run = (status: JobRun["status"]): JobRun => ({ job: "assortment-brightdata-collect", status, error: "Bright Data: нет денег или аккаунт не активен (402) [stop:billing]", started_at: ago(HOUR), rows_affected: 0 });
  assert.equal(jobsFreshness([run("error")], NOW).state, "stalled");
  assert.equal(jobsFreshness([run("partial")], NOW).state, "ok");
  assert.equal(jobsFreshness([run("ok")], NOW).state, "ok");
});

test("Ф2 по ревью: недельный потолок рилсов один — строка соцсетей; явный ASSORTMENT_SOCIAL_WEEKLY_REQUESTS сводится в неё же, и полоска показывает действующую строку", () => {
  assert.equal(engineBudgetConfig({}).socialWeeklyUsd, 3);
  assert.equal(engineBudgetConfig({ ASSORTMENT_SOCIAL_WEEKLY_REQUESTS: "1000" }).socialWeeklyUsd, 1.5, "1 000 запросов строже $3");
  assert.equal(engineBudgetConfig({ ASSORTMENT_SOCIAL_WEEKLY_REQUESTS: "4000", ASSORTMENT_SOCIAL_WEEKLY_USD: "4" }).socialWeeklyUsd, 4, "4 000 запросов ($6) шире строки $4 — строка");
  assert.equal(engineBudgetConfig({ ASSORTMENT_SOCIAL_WEEKLY_REQUESTS: "" }).socialWeeklyUsd, 3, "пусто — не задан");
  assert.equal(engineRoomUsd(engineWeek([{ kind: "brightdata_social", cost_usd: 1 }]), ENGINE_KIND.social, engineBudgetConfig({ ASSORTMENT_SOCIAL_WEEKLY_REQUESTS: "1000" })), 0.5);
});

test("Ф2 по ревью: запись расхода — сравнение-и-замена: параллельный писатель между чтением и записью не затирается", async () => {
  const tables: Record<string, Row[]> = { assortment_ai_usage: [{ day: "2026-10-07", kind: "brightdata:zara", calls: 100, failed_calls: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0.25, updated_at: "2026-10-07T05:00:00.000Z" }] };
  const inner = memoryDb(tables) as unknown as { from: (t: string) => Record<string, (...a: unknown[]) => unknown> };
  let raced = false;
  const db = {
    from: (table: string) => {
      const q = inner.from(table);
      const update = q.update;
      q.update = (values: unknown) => {
        // Другой прогон успел прибавить свои 40 записей между нашим чтением и записью.
        if (!raced) {
          raced = true;
          Object.assign(tables.assortment_ai_usage[0], { calls: 140, cost_usd: 0.35, updated_at: "2026-10-07T05:00:01.000Z" });
        }
        return update(values);
      };
      return q;
    },
  } as never;
  await addEngineUsage(db, NOW, "brightdata:zara", { calls: 20, costUsd: 0.05 });
  assert.deepEqual([tables.assortment_ai_usage[0].calls, tables.assortment_ai_usage[0].cost_usd], [160, 0.4], "100 + 40 (соседний прогон) + 20 (наш)");
});
