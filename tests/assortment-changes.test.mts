import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChangeCardView, ChangesBody, ChangesEmpty, ChangesUnavailable, datesText, runsLine } from "../components/assortment/ChangesView.tsx";
import {
  changesReadiness, changesTabVisible, computeChanges, DISAPPEAR_FULL_RUNS, isFirstSundayOfMonth, parseChangesPeriod, planChanges, runsToRead, seasonCaption,
  type ChangeRun, type SnapshotLite,
} from "../lib/assortment/appearance.ts";
import { loadChanges, loadChangesTab, loadDigestChanges, type ChangeCard, type ChangesResult, type DigestChanges } from "../lib/assortment/appearanceStore.ts";
import { isFeedView, sectionViewFrom, DEFAULT_CATALOG_FILTERS } from "../lib/assortment/catalog.ts";
import { initialNav, navAfterMenu, navSetFilters, navSetView } from "../lib/assortment/catalogNav.ts";
import { buildReadiness, type ReadinessInput } from "../lib/assortment/dataReadiness.ts";
import { digestMessage, type DigestDirection, type DigestFacts } from "../lib/assortment/digest.ts";
import { loadDigestFacts } from "../lib/assortment/digestFacts.ts";
import { announceMenuNavigate, isSectionMenuTarget, onMenuNavigate } from "../lib/assortment/menuSignal.ts";
import { summarizeHistory } from "../lib/assortment/observationState.ts";

/**
 * Ф3 «Появилось / пропало за неделю»: правило по полным прогонам, вкладка «Изменения», раздел воскресной сводки и месячная выжимка,
 * строка полоски «На чём стоят цифры», сброс вкладки меню модуля. Подставная база применяет фильтры, сортирует по order и режет
 * страницу на 1 000 строк, как PostgREST.
 */

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(join(root, path), "utf8");
const flat = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&quot;/g, "\"").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

// ---------------------------------------------------------------------------
// Правило — чистые функции

const TODAY = "2026-10-21"; // среда; неделя — прогоны после 14.10, «на начало периода» — 14.10 и раньше
type Cov = ChangeRun["coverage"];
let seq = 0;
const R = (day: string, coverage: Cov = "full", over: Partial<ChangeRun> = {}): ChangeRun => ({
  runId: `r${++seq}`, sourceId: "S300", direction: "jackets", observedOn: day, startedAt: `${day}T06:30:00Z`, coverage, part: null, ...over,
});
const lite = (ids: string[], title = (id: string) => `Модель ${id}`): SnapshotLite[] => ids.map((id) => ({ sourceItemId: id, title: title(id) }));

function changes(runs: Array<[ChangeRun, string[] | SnapshotLite[]]>, today = TODAY, period = 7) {
  const plan = planChanges(runs.map(([r]) => r), today, period);
  const snaps = new Map(runs.map(([r, rows]) => [r.runId, typeof rows[0] === "string" || rows.length === 0 ? lite(rows as string[]) : (rows as SnapshotLite[])]));
  const computed = computeChanges(plan, snaps);
  const ids = (kind: string) => computed.items.filter((i) => i.kind === kind).map((i) => i.itemId).sort();
  return { plan, ...computed, appeared: ids("appeared"), disappeared: ids("disappeared"), first: ids("first_window") };
}

test("«Пропало» — модели нет в двух полных прогонах подряд, а на начало периода была; даты прогонов — в карточке", () => {
  assert.equal(DISAPPEAR_FULL_RUNS, 2, "правило по рекомендации — пока владелец не скажет иное");
  const r = changes([[R("2026-10-01"), ["a", "b", "c"]], [R("2026-10-07"), ["a", "b", "c"]], [R("2026-10-14"), ["a", "b", "c"]], [R("2026-10-17"), ["a", "b"]], [R("2026-10-20"), ["a", "b"]]]);
  assert.deepEqual(r.disappeared, ["c"]);
  assert.deepEqual(r.appeared, []);
  const c = r.items.find((i) => i.itemId === "c")!;
  assert.equal(c.seenOn, "2026-10-14");
  assert.deepEqual(c.absentOn, ["2026-10-20", "2026-10-17"]);
  assert.equal(r.streams[0].disappearReady, true);
  // Пропажа подтвердилась вторым пропуском в периоде, хотя первый был до него (один прогон в периоде после пропущенного плана).
  const late = changes([[R("2026-10-01"), ["a", "c"]], [R("2026-10-07"), ["a", "c"]], [R("2026-10-12"), ["a"]], [R("2026-10-18"), ["a"]]]);
  assert.deepEqual(late.disappeared, ["c"], "подтверждено 18.10 — в периоде");
  // На прошлой неделе (сегодня 14.10) у той же истории — только один пропуск: ещё не «пропало».
  const before = changes([[R("2026-10-01"), ["a", "c"]], [R("2026-10-07"), ["a", "c"]], [R("2026-10-12"), ["a"]]], "2026-10-14");
  assert.deepEqual(before.disappeared, []);
});

test("Один пропуск — не «пропало»: нет только в последнем, или нет в предпоследнем и снова есть", () => {
  const lastOnly = changes([[R("2026-10-07"), ["a", "b", "c"]], [R("2026-10-14"), ["a", "b", "c"]], [R("2026-10-17"), ["a", "b", "c"]], [R("2026-10-20"), ["a", "b"]]]);
  assert.deepEqual(lastOnly.disappeared, []);
  const back = changes([[R("2026-10-07"), ["a", "b", "c"]], [R("2026-10-14"), ["a", "b", "c"]], [R("2026-10-17"), ["a", "b"]], [R("2026-10-20"), ["a", "b", "c"]]]);
  assert.deepEqual(back.disappeared, []);
  assert.deepEqual(back.appeared, [], "вернувшаяся модель — не «появилось»: на начало периода она была");
});

test("Оборванный (partial) прогон не засчитывается: ни его «нет», ни его «есть», и последним прогоном он не становится", () => {
  const partialGap = changes([[R("2026-10-07"), ["a", "b", "c"]], [R("2026-10-14"), ["a", "b", "c"]], [R("2026-10-17", "partial"), ["a", "b"]], [R("2026-10-20"), ["a", "b"]]]);
  assert.deepEqual(partialGap.disappeared, [], "пропуск в оборванном прогоне — не второй пропуск");
  const partialLast = changes([[R("2026-10-07"), ["a", "b"]], [R("2026-10-14"), ["a", "b"]], [R("2026-10-17"), ["a", "b"]], [R("2026-10-20", "partial"), ["a", "z"]]]);
  assert.equal(partialLast.plan.streams[0].latest?.observedOn, "2026-10-17");
  assert.deepEqual([partialLast.appeared, partialLast.disappeared], [[], []], "новая модель оборванного прогона — не «появилось», недосмотренная — не «пропало»");
  assert.ok(!runsToRead(partialLast.plan).some((r) => r.coverage === "partial"), "снимки оборванного прогона даже не читаются");
});

test("«Появилось»: при истории меньше 7 дней не показывается (поток копится, дата готовности — расчёт); с 7 дней — есть", () => {
  const young = changes([[R("2026-10-15"), ["a"]], [R("2026-10-20"), ["a", "n"]]]);
  assert.deepEqual(young.appeared, []);
  assert.equal(young.plan.streams[0].status, "building");
  assert.equal(young.plan.streams[0].readyOn, "2026-10-22", "первый полный 15.10 + 7");
  assert.deepEqual(runsToRead(young.plan), [], "копится — снимки не читаются");
  const week = changes([[R("2026-10-13"), ["a"]], [R("2026-10-20"), ["a", "n"]]]);
  assert.deepEqual(week.appeared, ["n"]);
  assert.equal(week.plan.streams[0].disappearReady, false, "двух полных прогонов мало для «пропало»");
  assert.equal(week.plan.streams[0].disappearRunsMissing, 1);
});

test("«Появилось» сверяется с двумя прогонами на начало периода: модель, случайно пропавшая в одном, не «новая»", () => {
  const r = changes([[R("2026-10-07"), ["a"]], [R("2026-10-13"), ["a", "n"]], [R("2026-10-14"), ["a"]], [R("2026-10-20"), ["a", "n", "m"]]]);
  assert.deepEqual(r.appeared, ["m"]);
});

test("Источник «только верх выдачи»: список «впервые в верху выдачи», «пропало» не бывает", () => {
  const W = (day: string) => R(day, "window", { sourceId: "S046" });
  const r = changes([[W("2026-10-01"), ["a", "b"]], [W("2026-10-11"), ["a", "b"]], [W("2026-10-14"), ["a", "b"]], [W("2026-10-18"), ["a"]], [W("2026-10-20"), ["a", "x"]]]);
  assert.equal(r.plan.streams[0].kind, "window");
  assert.deepEqual(r.first, ["x"]);
  assert.deepEqual([r.appeared, r.disappeared], [[], []], "b выпала из окна — не «пропало»");
  assert.equal(r.streams[0].disappearReady, false);
  // Оборванный прогон окна тоже не засчитывается: его новинка — не «впервые в верху выдачи».
  const cut = changes([[W("2026-10-01"), ["a"]], [W("2026-10-11"), ["a"]], [W("2026-10-14"), ["a"]], [W("2026-10-20"), ["a"]], [R("2026-10-21", "partial", { sourceId: "S046" }), ["a", "y"]]]);
  assert.equal(cut.plan.streams[0].latest?.observedOn, "2026-10-20");
  assert.deepEqual(cut.first, []);
});

test("Часть раздела (Zara CHAQUETA): своё «впервые в верху выдачи» без «пропало»; модели полного прогона в него не попадают", () => {
  const P = (day: string) => R(day, "window", { part: "zara_chaqueta" });
  const r = changes([
    [R("2026-10-07"), ["a", "b"]], [R("2026-10-14"), ["a", "b"]], [R("2026-10-20"), ["a", "b", "m"]],
    [P("2026-10-07"), ["p1", "a"]], [P("2026-10-14"), ["p1"]], [P("2026-10-20"), ["p2", "b", "m"]],
  ]);
  assert.deepEqual(r.appeared, ["m"], "основной раздел");
  assert.deepEqual(r.first, ["p2"], "b — в полном прогоне на начало периода, m — уже «появилось» в полном");
  assert.deepEqual(r.disappeared, [], "p1 выпала из части — не «пропало»");
  const part = r.plan.streams.find((s) => s.kind === "part")!;
  assert.equal(part.part, "zara_chaqueta");
  assert.equal(part.disappearReady, false);
});

test("Повтор обхода в тот же день — не второй полный прогон: «два подряд» — в разные дни", () => {
  const r = changes([
    [R("2026-10-07"), ["a", "b", "c"]], [R("2026-10-14"), ["a", "b", "c"]],
    [R("2026-10-20", "full", { startedAt: "2026-10-20T03:30:00Z" }), ["a", "b"]], [R("2026-10-20", "full", { startedAt: "2026-10-20T09:00:00Z" }), ["a", "b"]],
  ]);
  assert.deepEqual(r.disappeared, []);
  assert.equal(r.plan.streams[0].days, 3);
});

test("Расцветки одной модели — одна модель: новый цвет — не «появилось», пропал один цвет — не «пропало»", () => {
  const S = (day: string) => R(day, "full", { sourceId: "S014" });
  const rows = (pairs: Array<[string, string]>) => pairs.map(([id, title]) => ({ sourceItemId: id, title }));
  const r = changes([
    [S("2026-10-07"), rows([["1", "Tote Bag - Black"], ["5", "Duffel 30 - Grey"]])], [S("2026-10-14"), rows([["1", "Tote Bag - Black"], ["5", "Duffel 30 - Grey"]])],
    [S("2026-10-17"), rows([["2", "Tote Bag - Green"], ["5", "Duffel 30 - Grey"]])], [S("2026-10-20"), rows([["2", "Tote Bag - Green"], ["5", "Duffel 30 - Grey"], ["9", "Hilo Weekend Bag - Black"]])],
  ]);
  assert.deepEqual(r.appeared, ["9"]);
  assert.deepEqual(r.disappeared, [], "чёрный цвет Tote пропал, модель осталась");
});

test("Прогон без моделей раздела при соседнем с моделями — сравнение не делается (сбой сборщика ≠ «пропало всё»); нет прогона за период — «нет данных»", () => {
  const gap = changes([[R("2026-10-07"), ["a", "b"]], [R("2026-10-14"), ["a", "b"]], [R("2026-10-17"), ["a", "b"]], [R("2026-10-20"), []]]);
  assert.equal(gap.streams[0].status, "gap");
  assert.deepEqual([gap.appeared, gap.disappeared], [[], []]);
  const stale = changes([[R("2026-10-01"), ["a"]], [R("2026-10-10"), ["b"]]]);
  assert.equal(stale.plan.streams[0].status, "stale");
  assert.deepEqual(stale.appeared, []);
});

test("Массовая смена (сменился обход, а не ассортимент) помечена; модели не спрятаны", () => {
  const base = Array.from({ length: 100 }, (_, i) => `m${i}`);
  const fresh = Array.from({ length: 60 }, (_, i) => `n${i}`);
  const r = changes([[R("2026-10-07"), base], [R("2026-10-14"), base], [R("2026-10-20"), [...base, ...fresh]]]);
  assert.equal(r.appeared.length, 60);
  assert.equal(r.streams[0].mass, true);
  assert.ok(r.items.every((i) => i.mass));
  const small = changes([[R("2026-10-07"), base], [R("2026-10-14"), base], [R("2026-10-20"), [...base, "n1", "n2"]]]);
  assert.equal(small.streams[0].mass, false);
});

test("Месяц: на начало периода прогонов нет (история короче месяца) — база — самые ранние прогоны, даты видны", () => {
  const r = changes([[R("2026-10-12"), ["a", "b"]], [R("2026-10-19"), ["a", "b"]], [R("2026-10-26"), ["a"]], [R("2026-10-31"), ["a", "n"]]], "2026-11-01", 30);
  assert.deepEqual(r.appeared, ["n"]);
  assert.deepEqual(r.disappeared, ["b"]);
  assert.deepEqual(r.streams[0].baseOn, ["2026-10-19", "2026-10-12"]);
});

test("Читаются только нужные прогоны: у ежедневного источника — последние и на начало периода, не вся история", () => {
  const days = Array.from({ length: 20 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);
  const r = changes(days.map((d) => [R(d), ["a"]] as [ChangeRun, string[]]));
  const reads = runsToRead(r.plan).map((x) => x.observedOn).sort();
  assert.deepEqual(reads, ["2026-10-13", "2026-10-14", "2026-10-19", "2026-10-20"]);
  assert.equal(parseChangesPeriod("30"), 30);
  assert.equal(parseChangesPeriod("365"), 7, "чужой период — неделя");
  assert.equal(parseChangesPeriod(null), 7);
});

test("Вкладка «Изменения»: видна при «появилось/пропало — наблюдение» и при «динамике» (после 28 дней не пропадает); иначе нет", () => {
  assert.equal(changesTabVisible([{ status: "appearance" }]), true);
  assert.equal(changesTabVisible([{ status: "dynamics" }]), true, "через 28 дней статус меняется на «динамику» — вкладка остаётся");
  assert.equal(changesTabVisible([{ status: "building" }, { status: "window_only" }, { status: "none" }]), false, "верх выдачи и «копится» вкладку не открывают");
  // По журналу: 5 недель ежедневных полных прогонов — «динамика», вкладка есть.
  const rows = Array.from({ length: 35 }, (_, i) => ({ source_id: "S300", direction: "jackets", observed_on: `2026-${i < 30 ? "09" : "10"}-${String(i < 30 ? i + 1 : i - 29).padStart(2, "0")}`, coverage: "full" as const, seen: 1, added: 0, error: null, started_at: "x" }));
  const [h] = summarizeHistory(rows.map((r) => ({ ...r, started_at: `${r.observed_on}T06:30:00Z` })), "2026-10-06");
  assert.equal(h.status, "dynamics");
  assert.equal(h.fullDays, 35);
  assert.equal(changesTabVisible([h]), true);
});

test("Подпись сезона: в декабре–феврале «пропало» = «распродано или раскуплено»; в остальные месяцы подписи нет", () => {
  for (const day of ["2026-12-06", "2027-01-17", "2027-02-28"]) assert.match(seasonCaption(day) ?? "", /«пропало» = «распродано или раскуплено»/, day);
  for (const day of ["2026-11-29", "2027-03-01", "2026-10-21"]) assert.equal(seasonCaption(day), null, day);
});

test("Первое воскресенье месяца: 01.11.2026 и 04.10.2026 — да; 11.10 (второе воскресенье) и 02.11 (понедельник) — нет", () => {
  assert.equal(isFirstSundayOfMonth("2026-11-01"), true);
  assert.equal(isFirstSundayOfMonth("2026-10-04"), true);
  assert.equal(isFirstSundayOfMonth("2026-12-06"), true);
  assert.equal(isFirstSundayOfMonth("2026-10-11"), false);
  assert.equal(isFirstSundayOfMonth("2026-11-02"), false);
  assert.equal(isFirstSundayOfMonth("2026-11-08"), false);
});

// ---------------------------------------------------------------------------
// Подставная база

type Row = Record<string, unknown>;
interface FakeInit { tables: Record<string, Row[]>; missing?: string[]; missingColumns?: Record<string, string[]> }

function fakeDb(init: FakeInit) {
  const reads: Array<{ table: string; eq: Record<string, unknown>; range: [number, number] | null }> = [];
  const db = {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      const eqs: Record<string, unknown> = {};
      const orders: Array<{ column: string; ascending: boolean }> = [];
      let columns: string[] | null = null;
      let limit: number | null = null;
      let range: [number, number] | null = null;
      const exec = () => {
        if (init.missing?.includes(table)) return { data: null, error: { code: "42P01", message: `relation "public.${table}" does not exist` } };
        const absent = (columns ?? []).find((c) => init.missingColumns?.[table]?.includes(c));
        if (absent) return { data: null, error: { code: "42703", message: `column ${table}.${absent} does not exist` } };
        reads.push({ table, eq: { ...eqs }, range });
        let list = (init.tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
        if (orders.length) {
          list = list.slice().sort((a, b) => {
            for (const o of orders) {
              const x = String(a[o.column] ?? ""), y = String(b[o.column] ?? "");
              if (x !== y) return (x < y ? -1 : 1) * (o.ascending ? 1 : -1);
            }
            return 0;
          });
        }
        if (range) list = list.slice(range[0], Math.min(range[1] + 1, range[0] + 1000));
        else list = list.slice(0, 1000);
        if (limit != null) list = list.slice(0, limit);
        const data = list.map((r) => (columns ? Object.fromEntries(columns.map((c) => [c, r[c] ?? null])) : { ...r }));
        return { data, error: null, count: null };
      };
      const q: Record<string, unknown> = {
        select: (cols?: string) => {
          columns = cols && cols !== "*" ? cols.split(",").map((c) => c.trim()) : null;
          return q;
        },
        eq: (c: string, v: unknown) => { eqs[c] = v; filters.push((r) => r[c] === v); return q; },
        gte: (c: string, v: unknown) => (filters.push((r) => r[c] != null && String(r[c]) >= String(v)), q),
        lt: (c: string, v: unknown) => (filters.push((r) => r[c] != null && String(r[c]) < String(v)), q),
        in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), q),
        is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), q),
        not: (c: string, op: string, v: unknown) => {
          if (op === "is") filters.push((r) => (r[c] ?? null) !== v);
          else if (op === "in") {
            const list = String(v).replace(/[()]/g, "").split(",");
            filters.push((r) => !list.includes(String(r[c])));
          }
          return q;
        },
        or: (expr: string) => {
          const list = /not\.in\.\(([^)]*)\)/.exec(expr)?.[1].split(",") ?? [];
          filters.push((r) => r.source_id == null || !list.includes(String(r.source_id)));
          return q;
        },
        order: (column: string, opts?: { ascending?: boolean }) => (orders.push({ column, ascending: opts?.ascending !== false }), q),
        limit: (n: number) => ((limit = n), q),
        range: (a: number, b: number) => {
          range = [a, b];
          return Promise.resolve(exec());
        },
        maybeSingle: () => Promise.resolve(exec()).then((res) => (res.error ? res : { data: (res.data as Row[])[0] ?? null, error: null })),
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(exec()).then(resolve, reject),
      };
      return q;
    },
  };
  return { db: db as never, reads };
}

const NOW = new Date("2026-10-21T09:00:00Z"); // 12:00 МСК, среда
let runSeq = 0;
const run = (source: string, day: string, over: Row = {}): Row => ({
  run_id: `run-${++runSeq}`, source_id: source, direction: "jackets", observed_on: day, coverage: "full", seen: 0, added: 0, error: null, started_at: `${day}T06:30:00Z`, part: null, ...over,
});
const snaps = (r: Row, ids: string[], over: (id: string) => Row = () => ({})): Row[] => ids.map((id) => ({
  run_id: r.run_id, source_id: r.source_id, source_item_id: id, direction: r.direction ?? "jackets", observed_on: r.observed_on, present: true,
  title: `Куртка ${id}`, brand: null, image_urls: null, badges: null, ...over(id),
}));
const SOURCES: Row[] = [
  { source_id: "S300", name: "Askent", categories: ["jackets"], seed_urls: ["https://askent.ru/catalog/"] },
  { source_id: "S024", name: "Polène", categories: ["bags"], seed_urls: ["https://eu.polene-paris.com"] },
  { source_id: "S046", name: "ASOS", categories: ["jackets", "bags"], seed_urls: ["https://www.asos.com"] },
  { source_id: "S128", name: "Рынок РФ: WB", categories: ["jackets", "bags"], seed_urls: [] },
];

function world() {
  runSeq = 0;
  const askent = ["2026-10-07", "2026-10-14", "2026-10-17", "2026-10-20"].map((d) => run("S300", d));
  // 1 500 моделей в каждом прогоне: без листания (первая тысяча по номеру) «zz-new» и «zz-gone» были бы не видны.
  const many = Array.from({ length: 1500 }, (_, i) => `m${String(i).padStart(4, "0")}`);
  const snapshot: Row[] = [
    ...snaps(askent[0], [...many, "zz-gone", "zz-hidden-gone"]), ...snaps(askent[1], [...many, "zz-gone", "zz-hidden-gone"]),
    ...snaps(askent[2], many), ...snaps(askent[3], [...many, "zz-new", "zz-hidden"]),
  ];
  // Polène обходится «целиком» (direction null), курток у неё нет — в «Куртках» её нет вовсе.
  const polene = ["2026-10-07", "2026-10-14", "2026-10-20"].map((d) => run("S024", d, { direction: null }));
  for (const r of polene) snapshot.push(...snaps(r, ["p1"], () => ({ direction: "bags" })));
  snapshot.push(...snaps(polene[2], ["p-new"], () => ({ direction: "bags" })));
  // ASOS — только верх выдачи.
  const asos = ["2026-10-01", "2026-10-11", "2026-10-14", "2026-10-20"].map((d) => run("S046", d, { coverage: "window" }));
  for (const r of asos.slice(0, 3)) snapshot.push(...snaps(r, ["a1", "a2"]));
  snapshot.push(...snaps(asos[3], ["a1", "a-top"]));
  // «Рынок РФ» — замер рынка, не каталог бренда.
  const wb = ["2026-10-01", "2026-10-14", "2026-10-20"].map((d) => run("S128", d));
  for (const r of wb) snapshot.push(...snaps(r, [`wb-${r.observed_on}`]));
  // Строка без раздела вокруг (тот же источник, другой раздел) — фильтр по разделу снимка.
  snapshot.push(...snaps(askent[3], ["bag-1"], () => ({ direction: "bags" })));
  const items: Row[] = [
    { source_id: "S300", source_item_id: "zz-new", handle: "https://askent.ru/catalog/zz-new/", reference_id: "ref-1", image_urls: ["https://askent.ru/upload/zz-new.jpg"], brand: "ASKENT", hidden_at: null },
    { source_id: "S300", source_item_id: "zz-gone", handle: "https://askent.ru/catalog/zz-gone/", reference_id: null, image_urls: null, brand: null, hidden_at: null },
    { source_id: "S300", source_item_id: "zz-hidden", handle: null, reference_id: null, image_urls: null, brand: null, hidden_at: "2026-10-20T10:00:00Z" },
    { source_id: "S300", source_item_id: "zz-hidden-gone", handle: null, reference_id: null, image_urls: null, brand: null, hidden_at: "2026-10-20T10:00:00Z" },
    { source_id: "S046", source_item_id: "a-top", handle: "https://www.asos.com/a-top", reference_id: null, image_urls: null, brand: "Mango", hidden_at: null },
  ];
  return {
    assortment_sources: SOURCES,
    assortment_run: [...askent, ...polene, ...asos, ...wb],
    assortment_item_snapshot: snapshot,
    assortment_source_items: items,
    assortment_references: [{ id: "ref-1", status: "new" }],
  };
}

const ready = (r: ChangesResult) => {
  assert.equal(r.available, true);
  return r as Extract<ChangesResult, { available: true }>;
};

test("Вкладка по базе: появилось и пропало у полного источника, «впервые в верху выдачи» у ASOS; листание за 1 000 строк; чужие разделы, «Рынок РФ» и скрытые — вне", async () => {
  const { db, reads } = fakeDb({ tables: world() });
  const r = ready(await loadChanges(db, { direction: "jackets", periodDays: 7, now: NOW }));
  assert.equal(r.today, "2026-10-21");
  assert.equal(r.periodStart, "2026-10-14");
  assert.deepEqual(r.groups.appeared.map((c) => c.itemId), ["zz-new"]);
  assert.deepEqual(r.groups.disappeared.map((c) => c.itemId), ["zz-gone"]);
  assert.deepEqual(r.groups.firstInWindow.map((c) => c.itemId), ["a-top"]);
  assert.deepEqual(r.totals, { appeared: 1, disappeared: 1, firstInWindow: 1, hidden: 2 }, "«Не интересно» — модели нет в «Изменениях», число названо");
  const card = r.groups.appeared[0];
  assert.equal(card.brand, "ASKENT");
  assert.equal(card.sourceName, "Askent");
  assert.equal(card.productUrl, "https://askent.ru/catalog/zz-new/");
  assert.equal(card.image, "https://askent.ru/upload/zz-new.jpg");
  assert.equal(card.findingHref, "/assortment-development/jackets/ref-1");
  assert.equal(card.referenceStatus, "new");
  assert.equal(card.inCatalog, true);
  assert.deepEqual([card.seenOn, card.absentOn], ["2026-10-20", ["2026-10-14", "2026-10-07"]]);
  assert.deepEqual(r.groups.disappeared[0].absentOn, ["2026-10-20", "2026-10-17"]);
  const names = r.sources.map((s) => s.name);
  assert.deepEqual(names, ["Askent", "ASOS"]);
  assert.ok(!names.includes("Polène") && !names.includes("Рынок РФ: WB"));
  assert.equal(r.tabVisible, true);
  const asos = r.sources.find((s) => s.name === "ASOS")!;
  assert.deepEqual([asos.kind, asos.status, asos.historyStatus], ["window", "ready", "window_only"]);
  // Снимки — только нужных прогонов, по разделу, с листанием.
  const snapReads = reads.filter((x) => x.table === "assortment_item_snapshot");
  assert.ok(snapReads.every((x) => x.eq.direction === "jackets" && typeof x.eq.run_id === "string" && typeof x.eq.observed_on === "string"), "под индекс (день, источник) и по разделу");
  const runIds = new Set(snapReads.map((x) => x.eq.run_id));
  assert.equal(runIds.size, 4 + 3, "Askent — 4 прогона, ASOS — 3 (последний и два на начало периода)");
  assert.ok(snapReads.some((x) => x.range?.[0] === 1000), "вторая страница прочитана");
});

test("Без миграции слоя наблюдений — вкладки нет, причина названа; без колонки части — читаем без неё", async () => {
  const none = await loadChanges(fakeDb({ tables: {}, missing: ["assortment_run"] }).db, { direction: "jackets", periodDays: 7, now: NOW });
  assert.equal(none.available, false);
  assert.match((none as { reason: string }).reason, /202610050001/);
  assert.deepEqual(await loadChangesTab(fakeDb({ tables: {}, missing: ["assortment_run"] }).db, "jackets", NOW), { available: false, visible: false });
  const legacy = ready(await loadChanges(fakeDb({ tables: world(), missingColumns: { assortment_run: ["part"] } }).db, { direction: "jackets", periodDays: 7, now: NOW }));
  assert.deepEqual(legacy.groups.appeared.map((c) => c.itemId), ["zz-new"]);
  const noCatalogCols = ready(await loadChanges(fakeDb({ tables: world(), missingColumns: { assortment_source_items: ["hidden_at"] } }).db, { direction: "jackets", periodDays: 7, now: NOW }));
  assert.equal(noCatalogCols.totals.hidden, 0, "без колонок каталога — без «скрыто», но и без падения");
  assert.equal(noCatalogCols.groups.appeared.find((c) => c.itemId === "zz-new")?.productUrl, "https://askent.ru/catalog/zz-new/");
});

test("Вкладка (счёт): журнал без полных прогонов с разрывом 7 дней — вкладки нет; с ними — есть; «Рынок РФ» вкладку не открывает", async () => {
  const short = { assortment_sources: SOURCES, assortment_run: [run("S300", "2026-10-17"), run("S300", "2026-10-20"), run("S128", "2026-10-01"), run("S128", "2026-10-20")] };
  assert.deepEqual(await loadChangesTab(fakeDb({ tables: short }).db, "jackets", NOW), { available: true, visible: false });
  assert.deepEqual(await loadChangesTab(fakeDb({ tables: world() }).db, "jackets", NOW), { available: true, visible: true });
  assert.deepEqual(await loadChangesTab(fakeDb({ tables: world() }).db, "bags", NOW), { available: true, visible: true }, "Polène — сумки: два полных прогона с разрывом 13 дней");
});

// ---------------------------------------------------------------------------
// Экран — статический рендер

const card = (over: Partial<ChangeCard> = {}): ChangeCard => ({
  key: "appeared:S300|zz-new", kind: "appeared", sourceId: "S300", sourceName: "Askent", part: null, itemId: "zz-new", title: "Пуховик oversize", brand: "ASKENT",
  image: "https://askent.ru/upload/zz-new.jpg", productUrl: "https://askent.ru/catalog/zz-new/", referenceId: null, referenceStatus: null, findingHref: null, inCatalog: true,
  seenOn: "2026-10-20", absentOn: ["2026-10-14", "2026-10-07"], mass: false, ...over,
});

function result(over: Partial<Extract<ChangesResult, { available: true }>> = {}): Extract<ChangesResult, { available: true }> {
  return {
    available: true, direction: "jackets", today: "2026-10-21", periodDays: 7, periodStart: "2026-10-14", disappearRuns: 2, season: null,
    groups: { appeared: [card()], disappeared: [card({ key: "disappeared:S300|g", kind: "disappeared", itemId: "g", title: "Парка", seenOn: "2026-10-14", absentOn: ["2026-10-20", "2026-10-17"] })], firstInWindow: [] },
    totals: { appeared: 1, disappeared: 1, firstInWindow: 0, hidden: 0 },
    sources: [{ sourceId: "S300", name: "Askent", kind: "full", part: null, status: "ready", historyStatus: "appearance", readyOn: null, disappearReady: true, disappearRunsMissing: 0, latestOn: "2026-10-20", baseOn: ["2026-10-14", "2026-10-07"], recentOn: ["2026-10-20", "2026-10-17"], appeared: 1, disappeared: 1, firstInWindow: 0, mass: false }],
    tabVisible: true,
    ...over,
  };
}

test("Экран: группы «Появилось» и «Пропало» с датами прогонов, правило «2 полных прогона подряд» видимым текстом, одна колонка на телефоне, кнопки ≥ 44 px", () => {
  const html = renderToStaticMarkup(createElement(ChangesBody, { result: result() }));
  const text = flat(html);
  assert.match(text, /Появилось · 1/);
  assert.match(text, /Пропало · 1/);
  assert.match(text, /«Пропало» — модели нет в 2 полных прогонах подряд \(в разные дни\), а до них была; один пропуск — не «пропало»\./);
  assert.match(text, /Есть в полном прогоне 20\.10; не было в прогонах 07\.10 и 14\.10/);
  assert.match(text, /Последний раз — в полном прогоне 14\.10; нет в 2 полных прогонах подряд: 17\.10 и 20\.10/);
  assert.match(text, /ASKENT · Askent/);
  assert.match(text, /Пуховик oversize/);
  assert.match(text, /Где купить образец/);
  assert.match(html, /href="https:\/\/www\.vinted\.com\/catalog\?search_text=ASKENT%20%D0%9F%D1%83%D1%85%D0%BE%D0%B2%D0%B8%D0%BA%20oversize"/);
  assert.match(text, /Отобрать/);
  assert.match(text, /Не интересно/);
  assert.match(html, /grid grid-cols-1 gap-3 md:grid-cols-2/, "телефон — одна колонка");
  for (const button of html.match(/<button[^>]*>/g) ?? []) assert.match(button, /h-11|h-10 w-10|min-h-/, `цель нажатия ≥ 44 px: ${button}`);
  assert.match(text, /Источники и даты прогонов · 1/);
  assert.match(text, /Askent — прогоны 14\.10 → 20\.10: появилось — 1, пропало — 1/);
  assert.doesNotMatch(text, /₽|\$|€|цена|маржа|СПП|вероятност/i);
});

test("Экран: подпись сезона в январе видимым текстом; «пропало» ещё не считается — сказано, после скольких прогонов; верх выдачи — отдельной группой", () => {
  const jan = flat(renderToStaticMarkup(createElement(ChangesBody, { result: result({ today: "2027-01-17", season: seasonCaption("2027-01-17") }) })));
  assert.match(jan, /В январе–феврале «пропало» = «распродано или раскуплено»/);
  const pending = flat(renderToStaticMarkup(createElement(ChangesBody, { result: result({
    groups: { appeared: [card()], disappeared: [], firstInWindow: [card({ key: "first_window:S046|a-top", kind: "first_window", sourceId: "S046", sourceName: "ASOS", brand: "Mango", itemId: "a-top", title: "Trench" })] },
    totals: { appeared: 1, disappeared: 0, firstInWindow: 1, hidden: 3 },
    sources: [
      { ...result().sources[0], disappearReady: false, disappearRunsMissing: 1, disappeared: 0 },
      { sourceId: "S046", name: "ASOS", kind: "window", part: null, status: "ready", historyStatus: "window_only", readyOn: null, disappearReady: false, disappearRunsMissing: 0, latestOn: "2026-10-20", baseOn: ["2026-10-14"], recentOn: ["2026-10-20"], appeared: 0, disappeared: 0, firstInWindow: 1, mass: false },
    ],
  }) })));
  assert.doesNotMatch(pending, /Пропало ·/, "группы «Пропало» нет, пока правило не может сработать");
  assert.match(pending, /«Пропало» пока не считаем: Askent — после ещё 1 полного прогона/);
  assert.match(pending, /Впервые в верху выдачи · 1/);
  assert.match(pending, /ASOS — видим только верх выдачи или часть раздела/);
  assert.match(pending, /«Пропало» здесь не бывает/);
  assert.match(pending, /Без 3 моделей, скрытых кнопкой «Не интересно»/);
  assert.match(pending, /ASOS · только верх выдачи — прогоны 14\.10 → 20\.10: впервые в верху выдачи — 1/);
});

test("Экран: пустые состояния — ничего не готово (что копится и с какого дня), ничего не изменилось, нет журнала", () => {
  const building = result({
    groups: { appeared: [], disappeared: [], firstInWindow: [] }, totals: { appeared: 0, disappeared: 0, firstInWindow: 0, hidden: 0 },
    sources: [{ ...result().sources[0], status: "building", readyOn: "2026-10-24", latestOn: "2026-10-20", baseOn: [] }, { ...result().sources[0], name: "Sela", status: "building", readyOn: null }],
  });
  const t = flat(renderToStaticMarkup(createElement(ChangesBody, { result: building })));
  assert.match(t, /Сравнивать пока не по чему/);
  assert.match(t, /Askent — не раньше 24\.10; Sela — ждёт первого прогона \(расчёт\)/);
  assert.doesNotMatch(t, /Появилось ·/);
  const quiet = flat(renderToStaticMarkup(createElement(ChangesBody, { result: result({ groups: { appeared: [], disappeared: [], firstInWindow: [] }, totals: { appeared: 0, disappeared: 0, firstInWindow: 0, hidden: 0 } }) })));
  assert.match(quiet, /За неделю у брендов ничего не появилось и не пропало/);
  assert.match(quiet, /Сравнили 1 источник: Askent/);
  assert.match(quiet, /За неделю новых моделей нет\./);
  assert.match(flat(renderToStaticMarkup(createElement(ChangesEmpty, { sources: [] }))), /Сравнивать пока не по чему/);
  assert.match(flat(renderToStaticMarkup(createElement(ChangesUnavailable, { reason: "«Изменения» появятся после обновления базы" }))), /появятся после обновления базы/);
});

test("Карточка: уже находка — ссылка на неё, «Отобрать» только у новой; скрытая — «Вернуть»; без строки каталога — без кнопок (спрятаны, а не серые)", () => {
  const found = flat(renderToStaticMarkup(createElement(ChangeCardView, { card: card({ referenceId: "ref-1", referenceStatus: "selected", findingHref: "/assortment-development/jackets/ref-1" }), local: {} })));
  assert.match(found, /Отобрана · открыть/);
  assert.doesNotMatch(found, /Отобрать|Не интересно/);
  const fresh = renderToStaticMarkup(createElement(ChangeCardView, { card: card({ referenceId: "ref-2", referenceStatus: "new", findingHref: "/assortment-development/jackets/ref-2" }), local: {} }));
  assert.match(fresh, /href="\/assortment-development\/jackets\/ref-2"/);
  assert.match(flat(fresh), /Отобрать/);
  assert.match(flat(renderToStaticMarkup(createElement(ChangeCardView, { card: card(), local: { hidden: true } }))), /Скрыто: модель ушла из каталога и из «Изменений» Вернуть/);
  const orphan = renderToStaticMarkup(createElement(ChangeCardView, { card: card({ inCatalog: false }), local: {} }));
  assert.doesNotMatch(orphan, /disabled=""/);
  assert.doesNotMatch(flat(orphan), /Отобрать|Не интересно/);
  assert.equal(datesText(["2026-10-20", "2026-10-17", "2026-10-14"]), "14.10, 17.10 и 20.10");
  assert.equal(runsLine({ kind: "first_window", seenOn: "2026-10-20", absentOn: ["2026-10-14"] }), "В верху выдачи 20.10; не было в прогоне 14.10");
});

// ---------------------------------------------------------------------------
// Раздел, роут, меню

test("Раздел: вид «Изменения» из адреса и не лента находок; вкладка — по счёту журнала, при сбое счёта или по адресу; роут под ролями модуля", () => {
  assert.equal(sectionViewFrom({ view: "changes" }), "changes");
  assert.equal(isFeedView("changes"), false, "иначе раздел запросил бы /references?view=changes и показал «Находок пока нет»");
  const section = read("components/assortment/AssortmentSection.tsx");
  assert.match(section, /changesVisible \|\| changesCountFailed \|\| view === "changes" \? \[\{ id: "changes" as const, label: "Изменения" \}\]/);
  assert.match(section, /\/api\/assortment-development\/changes\?direction=\$\{direction\}&count=1/);
  assert.match(section, /\{view === "changes" && <ChangesView key=\{direction\} direction=\{direction\} \/>\}/);
  const route = read("app/api/assortment-development/changes/route.ts");
  assert.match(route, /export async function GET/);
  assert.match(route, /requireApiSession\(ASSORTMENT_ROLES\)/);
  assert.match(route, /params\.get\("timings"\) === "1"/, "замер ?timings=1");
  assert.match(route, /loadChangesTab\(db, direction\)/);
});

test("Меню модуля сбрасывает вкладку и фильтры, если открыт чистый адрес раздела (аудит F29): сигнал меню → раздел начинает заново", () => {
  const SECTION = "/assortment-development/jackets";
  let nav = initialNav("new", DEFAULT_CATALOG_FILTERS);
  nav = navSetFilters(navSetView(nav, "catalog"), { ...DEFAULT_CATALOG_FILTERS, source: "S300", q: "парка" });
  nav = navSetView(nav, "changes");
  const reset = navAfterMenu(nav, SECTION, SECTION);
  assert.equal(reset.view, "new");
  assert.deepEqual(reset.filters, DEFAULT_CATALOG_FILTERS);
  assert.equal(reset.key, nav.key + 1, "каталог пересоздаётся");
  assert.equal(navAfterMenu(nav, "/assortment-development/bags", SECTION), nav, "чужой пункт — обычный переход, состояние не трогаем");
  assert.equal(isSectionMenuTarget(`${SECTION}/?view=catalog#x`, SECTION), true);
  assert.equal(isSectionMenuTarget(`${SECTION}/123`, SECTION), false);
  // Сигнал доходит до подписчика и снимается отпиской.
  const target = new EventTarget();
  const got: string[] = [];
  const off = onMenuNavigate(target, (href) => got.push(href));
  announceMenuNavigate(target, SECTION);
  off();
  announceMenuNavigate(target, SECTION);
  assert.deepEqual(got, [SECTION]);
  // Проводка: оба меню (боковое и строка на телефоне) шлют сигнал, раздел его слушает.
  const shell = read("components/assortment/AssortmentShell.tsx");
  assert.equal((shell.match(/onNavigate=\{\(\) => announceMenuNavigate\(window, item\.href\)\}/g) ?? []).length, 2);
  const section = read("components/assortment/AssortmentSection.tsx");
  assert.match(section, /useEffect\(\(\) => onMenuNavigate\(window, \(href\) => \{\n\s+if \(!isSectionMenuTarget\(href, sectionHref\)\) return;\n\s+setNav\(\(cur\) => navAfterMenu\(cur, href, sectionHref\)\);/);
});

// ---------------------------------------------------------------------------
// Воскресная сводка

const emptyDir = (): DigestDirection => ({ newCount: 0, retailCount: 0, top: [], selected: 0, sampleNeeded: 0, rejected: 0, topReason: null });
const facts = (patch: Partial<DigestFacts> = {}): DigestFacts => ({
  from: "2026-10-11T07:00:00Z", to: "2026-10-18T07:00:00Z", directions: { bags: emptyDir(), jackets: emptyDir() }, collections: [], crawl: null, baseUrl: "https://panel.example/", ...patch,
});
const block = (periodDays: number, periodStart: string, today: string): NonNullable<DigestChanges["week"]> => ({
  periodDays, periodStart, today,
  directions: {
    jackets: { sources: [{ name: "Askent", appeared: 3, disappeared: 1, firstInWindow: 0, fromOn: "2026-10-11", toOn: "2026-10-18", mass: false }, { name: "ASOS", appeared: 0, disappeared: 0, firstInWindow: 2, fromOn: "2026-10-11", toOn: "2026-10-17", mass: false }], quiet: ["Rains"], examples: ["ASKENT · Пуховик <oversize>"] },
    bags: null,
  },
});

test("Сводка: раздел «Появилось / пропало за неделю» — итог по разделу, источники с датами прогонов, правило словами, ссылка на вкладку", () => {
  const text = digestMessage(facts({ changes: { week: block(7, "2026-10-11", "2026-10-18"), month: null, season: null, disappearRuns: 2 } }));
  assert.match(text, /<b>Появилось \/ пропало за неделю<\/b>\nПо полным прогонам обхода\. «Пропало» — модели нет в 2 полных прогонах подряд, а до них была\./);
  assert.match(text, /Куртки: появилось 3, пропало 1, впервые в верху выдачи 2\./);
  assert.match(text, /• Askent: \+3 \/ −1 \(прогоны 11\.10 → 18\.10\)/);
  assert.match(text, /• ASOS: впервые в верху выдачи 2 \(прогоны 11\.10 → 17\.10\)/);
  assert.match(text, /Новое: ASKENT · Пуховик &lt;oversize&gt;\./);
  assert.match(text, /Сумки: сравнивать пока не по чему — история полных прогонов копится или за период не было полного прогона\./);
  assert.match(text, /<a href="https:\/\/panel\.example\/assortment-development\/jackets\?view=changes">Куртки<\/a>/);
  assert.doesNotMatch(text, /За месяц/, "не первое воскресенье — без месячной выжимки");
  assert.doesNotMatch(text, /ничего не происходило|новых моделей не появилось/, "изменения есть — неделя не «пустая»");
  assert.doesNotMatch(text, /₽|\$|€|цена/i);
});

test("Сводка: в первое воскресенье месяца — ещё и «за месяц» с датами; зимой — подпись «распродано или раскуплено»; сбой — строка, а не молчание", () => {
  const text = digestMessage(facts({ changes: { week: block(7, "2026-10-25", "2026-11-01"), month: block(30, "2026-10-02", "2026-11-01"), season: null, disappearRuns: 2 } }));
  assert.match(text, /<b>За месяц: 02\.10–01\.11<\/b>\nСумки: сравнивать пока не по чему[^\n]*\nКуртки: появилось 3, пропало 1/);
  assert.equal((text.match(/view=changes/g) ?? []).length, 2, "ссылки на вкладку — один раз, под недельным разделом");
  const winter = digestMessage(facts({ changes: { week: block(7, "2026-12-29", "2027-01-05"), month: null, season: seasonCaption("2027-01-05"), disappearRuns: 2 } }));
  assert.match(winter, /«пропало» = «распродано или раскуплено»/);
  const failed = digestMessage(facts({ changes: { week: null, month: null, season: null, disappearRuns: 2, error: "statement timeout" } }));
  assert.match(failed, /<b>Появилось \/ пропало<\/b>\n⚠️ Не загрузилось: statement timeout/);
  assert.doesNotMatch(digestMessage(facts({ changes: null })), /Появилось \/ пропало/, "ни один источник не готов — раздела нет (историю называет «История каталогов»)");
});

test("Сводка по базе: неделя — всегда, месячная выжимка — только в первое воскресенье месяца; без журнала — раздела нет", async () => {
  const quiet = (day: string) => {
    // Askent: ежедневные полные прогоны с 01.10; в последний день — новая модель.
    runSeq = 0;
    const days: string[] = [];
    for (let d = Date.parse("2026-10-01T00:00:00Z"); d <= Date.parse(`${day}T00:00:00Z`); d += 86_400_000) days.push(new Date(d).toISOString().slice(0, 10));
    const runs = days.map((d) => run("S300", d));
    const snapshot = runs.flatMap((r, i) => snaps(r, i === runs.length - 1 ? ["a", "new"] : ["a"]));
    return { assortment_sources: SOURCES, assortment_run: runs, assortment_item_snapshot: snapshot, assortment_source_items: [], assortment_references: [] };
  };
  const sunday = await loadDigestChanges(fakeDb({ tables: quiet("2026-11-01") }).db, new Date("2026-11-01T07:00:00Z"));
  assert.ok(sunday?.week && sunday.month, "01.11 — первое воскресенье");
  assert.equal(sunday.month.periodStart, "2026-10-02");
  assert.deepEqual(sunday.week.directions.jackets?.sources.map((s) => [s.name, s.appeared, s.fromOn, s.toOn]), [["Askent", 1, "2026-10-25", "2026-11-01"]]);
  const second = await loadDigestChanges(fakeDb({ tables: quiet("2026-11-08") }).db, new Date("2026-11-08T07:00:00Z"));
  assert.ok(second?.week);
  assert.equal(second.month, null);
  assert.equal(await loadDigestChanges(fakeDb({ tables: {}, missing: ["assortment_run"] }).db, new Date("2026-11-01T07:00:00Z")), null);
  // Связка со сводкой: факты недели несут раздел.
  const loaded = await loadDigestFacts(fakeDb({ tables: { ...quiet("2026-11-01"), assortment_observations: [], assortment_decisions: [], assortment_collections: [], assortment_collection_items: [] } }).db, new Date("2026-10-25T07:00:00Z"), new Date("2026-11-01T07:00:00Z"), "https://panel.example");
  assert.ok(loaded.changes?.week && loaded.changes.month);
  assert.match(digestMessage(loaded), /За месяц: 02\.10–01\.11/);
});

// ---------------------------------------------------------------------------
// Полоска «На чём стоят цифры»

test("Полоска: по каким источникам «Изменения» честные, где пока только «появилось», где копится (дата) и где только верх выдачи", () => {
  const base: ReadinessInput = { today: "2026-10-21", nowMs: Date.parse("2026-10-21T09:00:00Z"), traits: null, demand: null, history: null, errors: [] };
  const report = buildReadiness({ ...base, history: { sources: [
    { name: "Askent", status: "appearance", firstDay: "2026-10-05", firstFullDay: "2026-10-05", fullDays: 6 },
    { name: "Zara", status: "appearance", firstDay: "2026-10-07", firstFullDay: "2026-10-07", fullDays: 2 },
    { name: "Sela", status: "building", firstDay: "2026-10-18", firstFullDay: "2026-10-18", fullDays: 1 },
    { name: "Pompa", status: "building", firstDay: "2026-10-18", firstFullDay: null, fullDays: 0 },
    { name: "ASOS", status: "window_only", firstDay: "2026-10-17", firstFullDay: null, fullDays: 0 },
  ] } });
  const text = report.groups.find((g) => g.key === "history")!.lines.map((l) => `${l.kind}: ${l.text}`).join(" | ");
  assert.match(text, /факт: Вкладка «Изменения»: «появилось» и «пропало» честные — Askent\./);
  assert.match(text, /факт: Вкладка «Изменения»: пока только «появилось», «пропало» \(2 полных прогона подряд без модели\): Zara — после ещё 1 полного прогона\./);
  assert.match(text, /оценка: Вкладка «Изменения» копится: Sela — не раньше 25\.10; Pompa — ждёт первого полного прогона\./);
  assert.match(text, /Только верх выдачи — в «Изменениях» список «впервые в верху выдачи», «пропало» у них не бывает: ASOS — с 24\.10\./);
  // Застрявший источник — без даты «не раньше сегодня».
  assert.deepEqual(changesReadiness([{ name: "Sela", status: "building", firstDay: "2026-09-01", firstFullDay: "2026-09-01" }], "2026-10-21", new Set(["Sela"])).map((l) => l.text), ["Вкладка «Изменения» копится: Sela — второй полный прогон не приходит."]);
  // Число полных дней приходит в полоску из журнала.
  assert.match(read("lib/assortment/dataReadinessStore.ts"), /fullDays: s\.fullDays/);
  const [h] = summarizeHistory([
    { source_id: "S1", direction: "jackets", observed_on: "2026-10-07", coverage: "full", seen: 1, added: 0, error: null, started_at: "2026-10-07T03:00:00Z" },
    { source_id: "S1", direction: "jackets", observed_on: "2026-10-07", coverage: "full", seen: 1, added: 0, error: null, started_at: "2026-10-07T09:00:00Z" },
    { source_id: "S1", direction: "jackets", observed_on: "2026-10-14", coverage: "full", seen: 1, added: 0, error: null, started_at: "2026-10-14T03:00:00Z" },
  ], "2026-10-21");
  assert.equal(h.fullDays, 2, "повтор в тот же день — один день");
});
