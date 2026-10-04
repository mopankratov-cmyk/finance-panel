import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { compareSupplyDemand } from "../lib/assortment/formsDemand.ts";
import { buildFormsReport } from "../lib/assortment/forms.ts";
import { MpstatsApiError } from "../lib/mpstats/client.ts";
import {
  addDays, compactQueries, daysBetween, demandByForm, distinctQueries, expandQueries, pickPrevious, planSnapshots,
  subjectsFor, WB_SUBJECTS, type SnapshotTask, type SubjectQueries,
} from "../lib/assortment/wbQueries.ts";
import { collectWbQuerySnapshots } from "../lib/assortment/wbQueriesStore.ts";

/** Спрос WB как собственная история: сжатие ответа MPSTATS, план недельных снимков, спрос по формам. */

const TODAY = "2026-10-05"; // последний закрытый день

test("Предметы: все силуэты раздела, id уникальны, у каждого раздела свои", () => {
  assert.equal(new Set(WB_SUBJECTS.map((s) => s.id)).size, WB_SUBJECTS.length);
  assert.deepEqual(subjectsFor("jackets").map((s) => s.name), ["Куртки", "Ветровки", "Пуховики", "Парки", "Бомберы", "Плащи", "Пальто", "Полупальто", "Жилеты"]);
  assert.deepEqual(subjectsFor("bags").map((s) => s.id), [50, 138]);
});

test("Даты: сдвиг и разница через границу месяца", () => {
  assert.equal(addDays("2026-10-05", -30), "2026-09-05");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(daysBetween("2026-09-05", "2026-10-05"), 30);
});

test("Сжатие ответа: верх по частотности, дубли и пустое выброшены, items необязателен", () => {
  const rows = [
    { word: "куртка", wb_count: 100, items_count: 7 },
    { word: "Куртка", wb_count: 300 },
    { word: "бомбер", wb_count: 200, items_count: 12.4 },
    { word: "ноль", wb_count: 0 },
    { word: "  ", wb_count: 50 },
    { word: "плащ", wb_count: Number.NaN },
  ];
  const out = compactQueries(rows);
  assert.deepEqual(out, [["Куртка", 300, null], ["бомбер", 200, 12]], "дубль «куртка/Куртка» — одна строка с большей частотностью");
  assert.equal(compactQueries(rows, 1).length, 1, "лимит верха");
});

test("Чтение снимка из базы: битые записи пропускаются, а не роняют экран", () => {
  assert.deepEqual(expandQueries([["бомбер", 200, 12], ["парка", 50, null], "мусор", [1, 2], ["x", "NaN"]]), [
    { word: "бомбер", wb_count: 200, items_count: 12 },
    { word: "парка", wb_count: 50, items_count: undefined },
  ]);
  assert.deepEqual(expandQueries(null), []);
});

test("План: ничего не снято — свежие срезы всех предметов, потом «прошлые» (сначала то, что видно на экране)", () => {
  const plan = planSnapshots([], TODAY);
  assert.equal(plan.length, WB_SUBJECTS.length * 2);
  assert.ok(plan.slice(0, WB_SUBJECTS.length).every((t) => t.kind === "current" && t.windowTo === TODAY));
  assert.ok(plan.slice(WB_SUBJECTS.length).every((t) => t.kind === "baseline" && t.windowTo === "2026-09-05"));
  assert.equal(plan[0].windowFrom, "2026-09-06", "окно 30 дней включительно");
});

test("План: свежий срез не старше недели — не трогаем; «прошлый» дозапрашивается один раз", () => {
  const fresh = WB_SUBJECTS.map((s) => ({ subjectId: s.id, windowTo: "2026-10-01" }));
  const plan = planSnapshots(fresh, TODAY);
  assert.ok(plan.every((t) => t.kind === "baseline"), "свежие уже есть");
  assert.ok(plan.every((t) => t.windowTo === "2026-09-01"), "прошлый — на 30 дней раньше свежего");
  const full = [...fresh, ...WB_SUBJECTS.map((s) => ({ subjectId: s.id, windowTo: "2026-09-01" }))];
  assert.deepEqual(planSnapshots(full, TODAY), [], "всё есть — MPSTATS не вызывается совсем");
});

test("План: срез старше недели снимается заново, прежний становится «прошлым» — baseline не нужен", () => {
  const old = [{ subjectId: 168, windowTo: "2026-09-04" }];
  const plan = planSnapshots(old, TODAY, subjectsFor("jackets").filter((s) => s.id === 168));
  assert.deepEqual(plan.map((t) => [t.kind, t.windowTo]), [["current", TODAY]], "срез 31 день назад — допустимый «прошлый» (допуск 20–45)");
});

test("План: граница недели — ровно 7 дней срез устарел, 6 — ещё свежий", () => {
  const jackets = subjectsFor("jackets").filter((s) => s.id === 168);
  assert.deepEqual(planSnapshots([{ subjectId: 168, windowTo: "2026-09-28" }], TODAY, jackets).filter((t) => t.kind === "current").map((t) => t.windowTo), [TODAY], "7 дней — снять заново");
  assert.deepEqual(planSnapshots([{ subjectId: 168, windowTo: "2026-09-29" }], TODAY, jackets).filter((t) => t.kind === "current"), [], "6 дней — не трогаем");
});

test("План: срез моложе 20 дней «прошлым» не считается — baseline нужен; от 20 дней — не нужен", () => {
  const jackets = subjectsFor("jackets").filter((s) => s.id === 168);
  const young = planSnapshots([{ subjectId: 168, windowTo: "2026-09-29" }, { subjectId: 168, windowTo: "2026-09-15" }], TODAY, jackets);
  assert.deepEqual(young.map((t) => [t.kind, t.windowTo]), [["baseline", "2026-08-30"]], "14 дней до свежего — слишком близко для роста за месяц");
  const enough = planSnapshots([{ subjectId: 168, windowTo: "2026-09-29" }, { subjectId: 168, windowTo: "2026-09-09" }], TODAY, jackets);
  assert.deepEqual(enough, [], "20 дней — ровно допуск");
});

test("«Прошлый» срез: ближайший к 30 дням в допуске; вне допуска — null (роста не показываем)", () => {
  const snaps = [{ windowTo: "2026-09-28" }, { windowTo: "2026-09-04" }, { windowTo: "2026-08-20" }, { windowTo: "2026-07-01" }];
  assert.equal(pickPrevious(snaps, TODAY)?.windowTo, "2026-09-04");
  assert.equal(pickPrevious([{ windowTo: "2026-09-28" }, { windowTo: "2026-07-01" }], TODAY), null);
});

function subject(name: string, current: Array<[string, number]>, previous: Array<[string, number]> | null = null): SubjectQueries {
  const rows = (list: Array<[string, number]>) => list.map(([word, wb_count]) => ({ word, wb_count }));
  return { subject: name, windowFrom: "2026-09-06", windowTo: TODAY, current: rows(current), previousTo: previous ? "2026-09-05" : null, previous: previous ? rows(previous) : null };
}

test("Спрос по формам: запросы раскладываются по формам, общее слово и безымянное — отдельно, один запрос один раз", () => {
  const report = demandByForm("jackets", [
    subject("Куртки", [["куртка женская", 10000], ["бомбер женский", 4000], ["пуховик зимний", 3000], ["женская зимняя", 500]]),
    subject("Бомберы", [["бомбер женский", 4000], ["бомбер", 2000]]),
  ]);
  assert.ok(report);
  assert.equal(report.queries, 5, "«бомбер женский» один раз");
  assert.equal(report.searches, 10000 + 4000 + 3000 + 500 + 2000);
  const byKey = Object.fromEntries(report.rows.map((r) => [r.key, r]));
  assert.equal(byKey.bomber.searches, 6000);
  assert.equal(byKey.bomber.queries, 2);
  assert.equal(byKey.puffer.searches, 3000);
  assert.equal(byKey.jacket.generic, true);
  assert.equal(byKey.jacket.shareOfNamed, null, "у общей формы доли среди названных нет");
  assert.equal(report.named, 9000, "названные формы: бомбер 6000 + пуховик 3000");
  assert.equal(byKey.bomber.shareOfNamed, 66.7);
  assert.deepEqual(report.unnamed, { queries: 1, searches: 500 });
  assert.deepEqual(report.rows.map((r) => r.key), ["bomber", "puffer", "jacket"], "конкретные формы выше общей, по частотности");
  assert.deepEqual(byKey.bomber.top.map((q) => q.word), ["бомбер женский", "бомбер"]);
  assert.equal(demandByForm("jackets", []), null);
});

test("Рост по форме: только по запросам из обоих срезов и только при достаточной базе", () => {
  const report = demandByForm("jackets", [
    subject("Куртки", [["бомбер женский", 6000], ["бомбер весенний", 800], ["пуховик", 400]], [["бомбер женский", 4000], ["пуховик", 300]]),
  ]);
  assert.ok(report);
  const byKey = Object.fromEntries(report.rows.map((r) => [r.key, r]));
  assert.equal(byKey.bomber.growthPct, 50, "6000 против 4000; новый «бомбер весенний» рост не раздувает");
  assert.equal(byKey.puffer.growthPct, null, "база 300 < 1000 — процент на малых числах не показываем");
  assert.equal(report.previousTo, "2026-09-05");
  const noPrev = demandByForm("jackets", [subject("Куртки", [["бомбер женский", 6000]])]);
  assert.equal(noPrev?.rows[0].growthPct, null);
  assert.equal(noPrev?.previousTo, null);
});

test("Запросы по сумкам: тоут и шопер — одна форма, рюкзак отдельно", () => {
  const report = demandByForm("bags", [subject("Сумки", [["сумка шопер", 5000], ["сумка тоут женская", 1000], ["рюкзак женский", 2000], ["сумка женская", 20000]])]);
  assert.ok(report);
  const byKey = Object.fromEntries(report.rows.map((r) => [r.key, r]));
  assert.equal(byKey.tote.searches, 6000);
  assert.equal(byKey.backpack.searches, 2000);
  assert.equal(byKey.bag.generic, true);
  assert.equal(distinctQueries([subject("A", [["Сумка", 1]]), subject("B", [["сумка", 3]])]).get("сумка")?.now, 3, "одинаковый запрос — берём большую частотность");
});

test("Спрос и каталоги: две доли среди названных форм, разница в п.п., общие формы не сравниваются", () => {
  const models = [
    ...Array.from({ length: 6 }, (_, i) => ({ sourceId: "S1", sourceName: "A", title: `Bomber jacket ${i}` })),
    ...Array.from({ length: 2 }, (_, i) => ({ sourceId: "S1", sourceName: "A", title: `Puffer jacket ${i}` })),
    ...Array.from({ length: 4 }, (_, i) => ({ sourceId: "S1", sourceName: "A", title: `Jacket plain ${i}` })),
  ];
  const supply = buildFormsReport("jackets", models);
  const demand = demandByForm("jackets", [subject("Куртки", [["куртка", 50000], ["бомбер", 1000], ["пуховик", 3000]])])!;
  const rows = compareSupplyDemand(supply, demand);
  assert.deepEqual(rows.map((r) => r.key), ["puffer", "bomber"], "по числу поисков; общая «куртка» не входит");
  const puffer = rows[0];
  assert.equal(puffer.supplyShare, 25, "2 из 8 моделей с названной формой");
  assert.equal(puffer.demandShare, 75);
  assert.equal(puffer.gap, 50);
  const bomber = rows[1];
  assert.equal(bomber.gap, -50, "в каталогах 75%, в поиске 25%");
});

// --- сборщик: по одному предмету, без лишних вызовов MPSTATS ---

function fakeDb() {
  const saved: Array<Record<string, unknown>> = [];
  const db = {
    from: () => ({
      upsert: async (row: Record<string, unknown>) => { saved.push(row); return { error: null }; },
    }),
  };
  return { db: db as never, saved };
}

const tasks = (n: number): SnapshotTask[] => subjectsFor("jackets").slice(0, n).map((subject) => ({ subject, kind: "current", windowFrom: "2026-09-06", windowTo: TODAY }));

test("Сборщик: каждый предмет — один вызов MPSTATS и одна запись; в базу идёт верх списка", async () => {
  const { db, saved } = fakeDb();
  const calls: Array<[number, string, string]> = [];
  const result = await collectWbQuerySnapshots(db, tasks(2), {
    fetchKeywords: async (id, d1, d2) => { calls.push([id, d1, d2]); return [{ word: "бомбер", wb_count: 10 }, { word: "куртка", wb_count: 99 }]; },
  });
  assert.deepEqual(calls, [[168, "2026-09-06", TODAY], [172, "2026-09-06", TODAY]]);
  assert.equal(result.done.length, 2);
  assert.equal(result.stoppedBy, null);
  assert.equal(saved.length, 2);
  assert.deepEqual(saved[0].queries, [["куртка", 99, null], ["бомбер", 10, null]]);
  assert.equal(saved[0].rows_total, 2);
  assert.equal(saved[0].direction, "jackets");
});

test("Сборщик: пустой ответ — не срез (иначе предмет «снят» на неделю), сбой одного не мешает остальным", async () => {
  const { db, saved } = fakeDb();
  const result = await collectWbQuerySnapshots(db, tasks(3), {
    fetchKeywords: async (id) => (id === 168 ? [] : id === 172 ? Promise.reject(new Error("MPSTATS API 500")) : [{ word: "парка", wb_count: 5 }]),
  });
  assert.equal(saved.length, 1, "записан только предмет с данными");
  assert.deepEqual(result.failed.map((f) => f.subject), ["Куртки", "Ветровки"]);
  assert.match(result.failed[0].error, /пустой список/);
  assert.equal(result.stoppedBy, null);
});

test("Сборщик: лимит и токен MPSTATS останавливают прогон — остальные предметы не дёргаем", async () => {
  for (const code of ["rate_limit", "auth"] as const) {
    const { db } = fakeDb();
    let calls = 0;
    const result = await collectWbQuerySnapshots(db, tasks(4), {
      fetchKeywords: async () => { calls += 1; throw new MpstatsApiError("x", code, code === "rate_limit" ? 429 : 401); },
    });
    assert.equal(calls, 1, `${code}: после отказа дальше не идём`);
    assert.equal(result.stoppedBy, code);
  }
});

test("Сборщик: после бюджета времени новый предмет не начинаем (один ответ MPSTATS — до 100 с)", async () => {
  const { db, saved } = fakeDb();
  let clock = 0;
  const result = await collectWbQuerySnapshots(db, tasks(4), {
    now: () => clock,
    startBudgetMs: 85_000,
    fetchKeywords: async () => { clock += 50_000; return [{ word: "парка", wb_count: 5 }]; },
  });
  assert.equal(saved.length, 2, "стартовали в 0 и 50 с; на 100-й секунде уже поздно");
  assert.equal(result.stoppedBy, "budget");
  assert.equal(result.planned, 4);
});

test("Крон сборщика: ровно один, GET-роут существует (Vercel зовёт кроны GET), предметы и MPSTATS берутся из общего кода", () => {
  const root = join(import.meta.dirname, "..");
  const vercel = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")) as { crons: Array<{ path: string; schedule: string }> };
  assert.deepEqual(vercel.crons.filter((c) => c.path === "/api/sync/assortment-wb-queries"), [{ path: "/api/sync/assortment-wb-queries", schedule: "15 */6 * * *" }]);
  const route = readFileSync(join(root, "app/api/sync/assortment-wb-queries/route.ts"), "utf8");
  assert.match(route, /export async function GET\(/);
  assert.match(route, /checkCronAuth/, "крон-роут за секретом");
  assert.match(route, /maxDuration = 300/, "ответ MPSTATS — до 100 с, по умолчанию функция не дождётся");
  assert.match(route, /subjectKeywordsFull/);
});
