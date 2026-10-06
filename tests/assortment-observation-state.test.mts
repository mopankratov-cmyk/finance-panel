import assert from "node:assert/strict";
import test from "node:test";
import { onlyKnownSources, runCountsText, summarizeHistory, type RunRow } from "../lib/assortment/observationState.ts";

const TODAY = "2026-10-20";
const run = (source_id: string, observed_on: string, coverage: RunRow["coverage"], over: Partial<RunRow> = {}): RunRow => ({
  source_id, direction: "jackets", observed_on, coverage, seen: 100, added: 0, error: null, started_at: `${observed_on}T05:00:00Z`, ...over,
});
const status = (rows: RunRow[], id = "S1") => summarizeHistory(rows, TODAY).find((h) => h.sourceId === id)?.status;

test("Нет прогонов — источника в сводке нет вовсе; один полный прогон — «копится»", () => {
  assert.deepEqual(summarizeHistory([], TODAY), []);
  assert.equal(status([run("S1", "2026-10-19", "full")]), "building");
});

test("Два полных прогона: разрыв меньше недели — всё ещё «копится», от недели — «появилось/пропало»", () => {
  assert.equal(status([run("S1", "2026-10-14", "full"), run("S1", "2026-10-19", "full")]), "building", "5 дней");
  assert.equal(status([run("S1", "2026-10-12", "full"), run("S1", "2026-10-19", "full")]), "appearance", "ровно 7 дней");
});

test("Динамика — от четырёх недель и четырёх дней наблюдений", () => {
  const days = ["2026-09-21", "2026-09-28", "2026-10-05", "2026-10-19"];
  assert.equal(status(days.map((d) => run("S1", d, "full"))), "dynamics", "28 дней, 4 дня");
  assert.equal(status(days.slice(1).map((d) => run("S1", d, "full"))), "appearance", "3 дня наблюдений — рано");
  assert.equal(status(["2026-09-22", "2026-10-05", "2026-10-19"].map((d) => run("S1", d, "full"))), "appearance", "26 дней — рано");
});

test("Источник только с окном (ASOS, H&M) — «только верх выдачи», как бы долго ни копилось; частичные и окно не дают «появилось»", () => {
  const windows = ["2026-09-01", "2026-09-15", "2026-10-01", "2026-10-15"].map((d) => run("S1", d, "window"));
  assert.equal(status(windows), "window_only");
  assert.equal(status([run("S1", "2026-10-01", "partial"), run("S1", "2026-10-19", "window")]), "building");
  assert.equal(status([run("S1", "2026-10-01", "full"), run("S1", "2026-10-19", "partial")]), "building", "оборванный прогон полным не считается");
});

test("Сводка: счётчики полноты, дни, глубина, последний полный, ошибка оборванного прогона; два раздела одного источника — один источник", () => {
  const rows = [
    run("S1", "2026-10-05", "full"),
    run("S1", "2026-10-05", "full", { direction: "bags" }),
    run("S1", "2026-10-12", "window"),
    run("S1", "2026-10-19", "partial", { seen: 0, error: "deadline" }),
    run("S2", "2026-10-19", "full", { seen: 42 }),
  ];
  const [s1, s2] = summarizeHistory(rows, TODAY);
  assert.equal(s1.sourceId, "S1");
  assert.deepEqual([s1.runs, s1.full, s1.window, s1.partial], [4, 2, 1, 1]);
  assert.equal(s1.days, 3, "05, 12 и 19 октября");
  assert.equal(s1.firstDay, "2026-10-05");
  assert.equal(s1.spanDays, 15);
  assert.equal(s1.lastFullOn, "2026-10-05");
  assert.equal(s1.lastSeen, 0);
  assert.equal(s1.lastError, "deadline");
  assert.equal(s2.lastSeen, 42);
  assert.equal(s2.lastError, null);
});

// --- чтение журнала ---

import { loadHistoryState } from "../lib/assortment/observationStateStore.ts";

function runsDb(opts: { rows?: RunRow[]; error?: { code?: string; message: string } }) {
  const filters: string[] = [];
  const q: Record<string, unknown> = {
    select: () => q,
    gte: (c: string, v: unknown) => { filters.push(`${c}>=${v}`); return q; },
    order: () => q,
    range: () => Promise.resolve(opts.error ? { data: null, error: opts.error } : { data: opts.rows ?? [], error: null }),
  };
  return { db: { from: () => q } as never, filters };
}

test("Чтение журнала: окно 120 дней по московской дате; нет таблицы — available false, а не ошибка", async () => {
  const { db, filters } = runsDb({ rows: [run("S1", "2026-10-19", "full")] });
  const state = await loadHistoryState(db, new Date("2026-10-20T10:00:00Z"));
  assert.equal(state.available, true);
  assert.equal(state.today, "2026-10-20");
  assert.equal(state.sources.length, 1);
  assert.deepEqual(filters, ["observed_on>=2026-06-22"], "120 дней назад");
  const missing = await loadHistoryState(runsDb({ error: { code: "42P01", message: 'relation "public.assortment_run" does not exist' } }).db, new Date("2026-10-20T10:00:00Z"));
  assert.deepEqual([missing.available, missing.sources.length], [false, 0]);
  await assert.rejects(() => loadHistoryState(runsDb({ error: { message: "boom" } }).db), /boom/);
});

test("История на экране «Источники»: чужие источники (их строки показывались бы сырыми ключами S212) отбрасываются; список источников ещё не загружен — не режем", () => {
  const rows = [{ sourceId: "S1" }, { sourceId: "S212" }, { sourceId: "S3" }];
  assert.deepEqual(onlyKnownSources(rows, new Set(["S1", "S3"])).map((r) => r.sourceId), ["S1", "S3"]);
  assert.equal(onlyKnownSources(rows, new Set()).length, 3, "известных источников нет — показываем как есть, а не пустоту");
});

// --- части разделов (Zara CHAQUETA, коллаборации Uniqlo): прогон идёт после основного ---

test("Прогон части после оборванного основного не прячет «последний оборван» и не считается «по верху выдачи»", () => {
  const rows: RunRow[] = [
    run("S001", "2026-10-07", "partial", { seen: 950, error: "снимок записан не полностью", started_at: "2026-10-07T06:31:00Z" }),
    run("S001", "2026-10-07", "window", { seen: 180, started_at: "2026-10-07T06:32:00Z", part: "zara_chaqueta" }),
  ];
  const [h] = summarizeHistory(rows, "2026-10-07");
  assert.equal(h.lastError, "снимок записан не полностью", "последний ОСНОВНОЙ прогон оборван — так и видно");
  assert.equal(h.lastSeen, 950);
  assert.deepEqual([h.runs, h.full, h.window, h.partial, h.parts], [2, 0, 0, 1, 1], "часть — не верх выдачи и не оборванный прогон");
  assert.deepEqual(h.partNames, ["zara_chaqueta"]);
  assert.equal(runCountsText(h), "прогонов 2 (полных 0, по верху выдачи 0, оборванных 1, частей раздела 1)");
  assert.equal(runCountsText({ runs: 3, full: 2, window: 1, partial: 0, parts: 0 }), "прогонов 3 (полных 2, по верху выдачи 1, оборванных 0)", "без частей — как раньше");
});

test("Части не меняют статус: полные основные прогоны с разрывом неделя — «появилось/пропало»; источник с окнами и частью — «только верх выдачи»", () => {
  const zara = [
    run("S1", "2026-10-07", "full"), run("S1", "2026-10-07", "window", { part: "zara_chaqueta", started_at: "2026-10-07T06:40:00Z" }),
    run("S1", "2026-10-14", "full"), run("S1", "2026-10-14", "window", { part: "zara_chaqueta", started_at: "2026-10-14T06:40:00Z" }),
  ];
  const [h] = summarizeHistory(zara, TODAY);
  assert.equal(h.status, "appearance");
  assert.equal(h.lastFullOn, "2026-10-14");
  assert.equal(h.lastError, null);
  assert.equal(status([run("S1", "2026-10-01", "window"), run("S1", "2026-10-01", "partial", { part: "uniqlo_collab", started_at: "2026-10-01T06:40:00Z" })]), "window_only", "оборванная часть не делает источник «копится»");
});

test("Чтение журнала: пометка части читается; миграции 202610060010 ещё нет — журнал читается без неё, а не падает", async () => {
  const selects: string[] = [];
  const db = (withPart: boolean) => ({
    from: () => {
      let columns = "";
      const q: Record<string, unknown> = {
        select: (c: string) => { columns = c; selects.push(c); return q; },
        gte: () => q, order: () => q,
        range: () => Promise.resolve(columns.includes("part") && !withPart
          ? { data: null, error: { code: "42703", message: "column assortment_run.part does not exist" } }
          : { data: [run("S1", "2026-10-19", "partial", { error: "x" }), run("S1", "2026-10-19", "window", { started_at: "2026-10-19T06:00:00Z", ...(withPart ? { part: "zara_chaqueta" } : {}) })], error: null }),
      };
      return q;
    },
  }) as never;
  const fresh = await loadHistoryState(db(true), new Date("2026-10-20T10:00:00Z"));
  assert.match(selects[0], /,part$/);
  assert.deepEqual([fresh.sources[0].parts, fresh.sources[0].lastError], [1, "x"]);
  selects.length = 0;
  const legacy = await loadHistoryState(db(false), new Date("2026-10-20T10:00:00Z"));
  assert.equal(selects.length, 2, "повтор без колонки");
  assert.doesNotMatch(selects[1], /part/);
  assert.equal(legacy.available, true);
  assert.deepEqual([legacy.sources[0].parts, legacy.sources[0].lastError], [0, null], "без миграции части не отличить — как до неё");
});
