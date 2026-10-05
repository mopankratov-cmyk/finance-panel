import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PhotoTraitsError } from "../components/assortment/PhotoTraits.tsx";
import { ReadinessStrip } from "../components/assortment/DataReadiness.tsx";
import { PROMPT_VERSION, type PhotoTraitsReport } from "../lib/assortment/catalogAi.ts";
import { buildReadiness, type DemandFacts, type HistorySource, type ReadinessInput, type TraitsFacts } from "../lib/assortment/dataReadiness.ts";
import { loadReadiness } from "../lib/assortment/dataReadinessStore.ts";

/** «На чём стоят цифры»: что копится, с какого дня и когда функция станет честной (05.10). Даты — расчёт, не обещание. */

const root = fileURLToPath(new URL("..", import.meta.url));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const NOW = Date.parse("2026-10-06T10:00:00Z");
const traits = (over: Partial<TraitsFacts> = {}): TraitsFacts => ({
  enabled: true, keyConfigured: true, priced: true, model: "google/gemini-2.5-flash", analyzed: 62, legacy: 0, eligible: 1172, failed: 0, recentOk: 62, recentFailed: 0,
  lastOkAt: "2026-10-06T09:00:00Z", otherRemaining: 0, callsToday: 27, dailyLimit: 1500, weekUsd: 0.03, weeklyBudgetUsd: 20, budgetCallsLeft: 5000, lastErrors: [], ...over,
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
  assert.match(lines(buildReadiness(input({ traits: traits({ analyzed: 1172 }) })), "traits"), /Очередь разобрана/);
  const kinds = r.groups[0].lines.map((l) => l.kind);
  assert.ok(kinds.includes("факт") && kinds.includes("расчёт"), "каждая строка помечена: факт или расчёт");
});

test("Очередь общая для двух разделов: остаток другого раздела назван и входит в срок; бюджета недели меньше очереди — отдельная строка", () => {
  const r = buildReadiness(input({ traits: traits({ analyzed: 1000, eligible: 1172, otherRemaining: 1400, budgetCallsLeft: 800 }) }));
  const t = lines(r, "traits");
  assert.match(t, /Осталось разобрать 172 \(в другом разделе ещё 1\s400: очередь у сборщика общая\)/);
  assert.match(t, /на всё уйдёт от 2 до 2 суток|на всё уйдёт около 2 суток|на всё уйдёт от 2 до 3 суток/);
  assert.match(t, /Остатка бюджета недели хватит примерно на 800 вызовов — меньше очереди \(1\s572\): разбор встанет раньше, чем она закончится\./);
  const fine = lines(buildReadiness(input({ traits: traits({ analyzed: 1000, otherRemaining: 0, budgetCallsLeft: 5000 }) })), "traits");
  assert.doesNotMatch(fine, /Остатка бюджета/);
});

test("Остановки по настройке названы и раскрывают полоску: выключен, нет ключа, нет цены у модели, потолок 0, бюджет недели 0 и исчерпан; потолок суток — не проблема", () => {
  const cases: Array<[Partial<TraitsFacts>, RegExp]> = [
    [{ enabled: false }, /Разбор выключен/],
    [{ keyConfigured: false }, /нет ключа ИИ/],
    [{ priced: false, model: "claude-unknown-9" }, /Для модели «claude-unknown-9» нет цены в таблице: сборщик не запускается/],
    [{ dailyLimit: 0 }, /Потолок суток 0: разбор остановлен/],
    [{ weeklyBudgetUsd: 0, budgetCallsLeft: null }, /Бюджет недели 0: разбор остановлен/],
    [{ weekUsd: 20.5 }, /Бюджет недели исчерпан/],
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
  const stalled = buildReadiness(input({ traits: traits({ lastOkAt: "2026-10-04T08:00:00Z" }) }));
  assert.equal(stalled.problem, true);
  assert.match(lines(stalled, "traits"), /Последняя модель разобрана 04\.10 в 11:00 МСК\. Прошло больше 24 часов при непустой очереди — разбор не движется/);
  const fresh = buildReadiness(input());
  assert.match(lines(fresh, "traits"), /Последняя модель разобрана 06\.10 в 12:00 МСК\.$/m);
  assert.equal(fresh.problem, false);
  const done = buildReadiness(input({ traits: traits({ analyzed: 1172, lastOkAt: "2026-10-01T08:00:00Z" }) }));
  assert.equal(done.problem, false, "очередь пуста — давнее «последняя» не тревога");
  const stopped = buildReadiness(input({ traits: traits({ enabled: false, lastOkAt: "2026-10-01T08:00:00Z" }) }));
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

test("История каталогов: даты по каждому источнику от ЕГО первого полного прогона (+7), прошедшая дата — «не раньше сегодня»; без полного прогона — «ждёт»; динамика от самого раннего (+28)", () => {
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
  assert.match(h, /«Появилось» и «пропало» — наблюдение: Zara\./);
  assert.match(h, /История копится: Polène, Rains, Uniqlo, Sela\./);
  assert.match(h, /Sela — не раньше 06\.10; Polène — не раньше 12\.10; Rains — не раньше 19\.10/, "у каждого источника своя дата; у Sela 17.09 в прошлом — «не раньше сегодня»");
  assert.match(h, /Ждут первого полного прогона: Uniqlo — для них даты пока нет\./);
  assert.match(h, /Динамика — не раньше 08\.10 \(28 дней наблюдений и не меньше 4 дней с прогонами\)/, "от самого раннего первого дня 10.09 + 28 = 08.10");
  assert.match(h, /Только верх выдачи, «пропало» не определить: ASOS\./);
  assert.doesNotMatch(h, /растёт|падает/);
  assert.equal(buildReadiness(input({ traits: null, history: { sources: [] } })).groups.length, 0);
  const none = lines(buildReadiness(input({ traits: null, history: { sources: [src("Zara", "appearance", "2026-09-01")] } })), "history");
  assert.doesNotMatch(none, /не раньше/, "нечего ждать — нет и дат");
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
  assert.match(text(bad), /факт У разбора нет ключа ИИ/);
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
function fakeDb(tables: Record<string, Row[]>, opts: { missing?: string[]; failing?: string[] } = {}) {
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
      const failure = () => (opts.missing?.includes(table) ? { code: "42P01", message: `relation "${table}" does not exist` } : opts.failing?.includes(table) ? { message: "таймаут запроса" } : null);
      const result = () => (failure() ? { data: null, error: failure(), count: null } : { data: rows(), error: null, count: wantCount ? (tables[table] ?? []).filter((r) => preds.every((p) => p(r))).length : null });
      const q: Record<string, unknown> = {
        select: (_c: string, o?: { count?: string }) => { wantCount = Boolean(o?.count); return q; },
        eq: (c: string, v: unknown) => { call.filters.push(`eq:${c}=${v}`); preds.push((r) => r[c] === v); return q; },
        neq: (c: string, v: unknown) => { preds.push((r) => r[c] !== v); return q; },
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

test("Чтение базы: «разобрано N из M» — из того же отчёта, что блок «Признаки по фото» (скрытые и пропавшие модели не в числителе); остаток другого раздела; неудачи и последняя модель", async () => {
  const seen: string[] = [];
  const traitsLoader = async (_db: unknown, direction: string) => {
    seen.push(direction);
    return direction === "bags" ? report({ analyzed: 4, legacy: 3, catalog: 1000 }) : report({ direction: "jackets", analyzed: 900, catalog: 1300 });
  };
  const { db } = fakeDb({
    // 40 строк результатов в базе, но в текущем каталоге из них только 4: остальные скрыты или пропали с сайта — отчёт их уже отсёк
    assortment_model_attributes: [
      ...Array.from({ length: 40 }, () => attr("ok")),
      attr("failed", { last_error: "HTTP 403" }), attr("failed", { last_error: "HTTP 403" }), attr("failed", { last_error: "фото не скачалось" }),
      attr("ok", { taken_at: "2026-10-06T09:30:00Z" }),
    ],
    assortment_ai_usage: [{ day: "2026-10-06", kind: "catalog_attributes", calls: 40, cost_usd: 0.07 }],
  });
  const r = await loadReadiness(db, "bags", new Date("2026-10-06T10:00:00Z"), { traits: traitsLoader as never });
  const t = lines(r, "traits");
  assert.match(t, /Разобрано по фото 4 из 1\s000 моделей \(0,4%\)/, "числитель — отчёт по каталогу, а не 41 строка таблицы");
  assert.match(t, /ещё 3 разобраны по прежнему вопросу/);
  assert.match(t, /в другом разделе ещё 400: очередь у сборщика общая/);
  assert.match(t, /Не разобралось 3 модели .*: HTTP 403 \(2\); фото не скачалось \(1\)/);
  assert.match(t, /Последняя модель разобрана 06\.10 в 12:30 МСК/);
  assert.deepEqual(seen.sort(), ["bags", "jackets"], "отчёт по двум разделам — как у блока на экране");
  assert.deepEqual(r.errors, []);
});

test("Чтение базы: сбой вида каталога не превращается в «100%, очередь разобрана»; сбой части называется в errors, остальные части живы", async () => {
  const noReport = async () => null;
  const { db } = fakeDb({
    assortment_model_attributes: [attr("failed", { last_error: "x" })],
    assortment_catalog_stats: [{ source_id: "S001", direction: "bags", with_photo: 700 }, { source_id: "S128", direction: "bags", with_photo: 500 }],
    assortment_run: [{ source_id: "S001", direction: "bags", observed_on: "2026-10-05", coverage: "full", seen: 1, added: 0, error: null, started_at: "2026-10-05T08:00:00Z" }],
    assortment_sources: [{ source_id: "S001", name: "Zara" }],
  }, { failing: ["assortment_wb_query_snapshot"] });
  const r = await loadReadiness(db, "bags", new Date("2026-10-06T10:00:00Z"), { traits: noReport as never });
  assert.match(lines(r, "traits"), /Разобрано по фото 0 из 700 моделей \(0%\)/, "знаменатель — с фото, без «Рынка РФ»; числитель честный ноль");
  assert.match(lines(r, "traits"), /Осталось разобрать 700/);
  assert.deepEqual(r.groups.map((g) => g.key), ["traits", "history"], "спрос не прочитался — блока нет, остальные есть");
  assert.deepEqual(r.errors, ["спрос на WB (таймаут запроса)"], "сбой назван, а не спрятан");
  const broken = fakeDb({ assortment_model_attributes: [], assortment_catalog_stats: [] }, { failing: ["assortment_catalog_stats"] });
  const r2 = await loadReadiness(broken.db, "bags", new Date("2026-10-06T10:00:00Z"), { traits: noReport as never });
  assert.ok(r2.errors.some((e) => /признаки по фото/.test(e)), "упавший счётчик каталога — это сбой, а не «100%»");
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
  assert.doesNotMatch(hb, /«Появилось» и «пропало» — наблюдение: Zara/, "по сумкам у Zara один полный прогон — это не наблюдение");
  assert.match(hb, /История копится: Zara, JW PEI|История копится: JW PEI, Zara/);
  const hj = lines(jackets, "history");
  assert.match(hj, /«Появилось» и «пропало» — наблюдение: Zara\./, "по курткам два полных с разрывом 7 дней");
});

test("Роут и экран: под сессией модуля, числа — из общего кэшированного отчёта, MPSTATS и ИИ не вызываются; полоска не ждёт «Форм»", () => {
  const route = readFileSync(join(root, "app/api/assortment-development/data-readiness/route.ts"), "utf8");
  assert.match(route, /requireApiSession\(ASSORTMENT_ROLES\)/);
  assert.match(route, /export const dynamic = "force-dynamic"/);
  assert.match(route, /\{ traits: loadPhotoTraitsCached \}/, "тот же отчёт и тот же кэш, что у блока «Признаки по фото»");
  assert.doesNotMatch(route, /^import .*(mpstats|anthropic|polza|runCatalogAi)/im, "роут не тянет клиенты MPSTATS и ИИ");
  const store = readFileSync(join(root, "lib/assortment/dataReadinessStore.ts"), "utf8");
  assert.doesNotMatch(store.replace(/\/\*[\s\S]*?\*\//g, ""), /lib\/mpstats|mpstatsWbQuota|runCatalogAi|askFor\(/, "и хранилище: ни квоты MPSTATS, ни запуска разбора");
  const traitsRoute = readFileSync(join(root, "app/api/assortment-development/photo-traits/route.ts"), "utf8");
  assert.match(traitsRoute, /loadPhotoTraitsCached\(db, direction\)/);
  const forms = readFileSync(join(root, "components/assortment/FormsView.tsx"), "utf8");
  const mount = forms.indexOf("<DataReadiness");
  assert.ok(mount > 0 && mount < forms.indexOf('state.kind === "loading"'), "полоска стоит выше веток загрузки «Форм»: у неё свой запрос, она не ждёт отчёт и не сдвигает его");
});
