import assert from "node:assert/strict";
import test from "node:test";
import { onlyKnownSources, summarizeHistory, type RunRow } from "../lib/assortment/observationState.ts";

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
