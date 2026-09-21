import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildLightweightProductTotals, buildMetrics } from "../lib/rnp/buildTable";
import {
  emptyStockHistory, loadStockHistory, mergeStockHistories, parseStockHistory, stockDailySeries, stockSeriesForSku, stockSeriesForSummary,
} from "../lib/rnp/stockHistory";
import { STOCK_SNAPSHOT_HOUR_MSK, WB_WAREHOUSE_SQL_PATTERN, isWbWarehouse } from "../lib/wb/realStock";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/**
 * История остатков по дням в РНП.
 *
 * До сих пор остаток был точкой — только сегодняшний снимок, прошлые дни пустые.
 * Владелец 21.09.2026: нужна история каждый день, снимок на фиксированный час, и
 * реален только остаток на «Склад WB»: склады по городам после пожара пусты, а
 * их строки в отчёте WB — фантом.
 */

// ── Что считается реальным складом ───────────────────────────────────────────

test("реальный склад — «Склад WB» (FBW и FBS), склады по городам — нет", () => {
  for (const name of ["Склад WB РФ", "Склад WB", "  склад wb рф ", "Склад ВБ"]) assert.equal(isWbWarehouse(name), true, name);
  for (const name of ["Коледино", "Казань", "Электросталь", "В пути до получателей", "", null, undefined]) assert.equal(isWbWarehouse(name as string), false, String(name));
  assert.equal(new RegExp(WB_WAREHOUSE_SQL_PATTERN, "i").test("Склад WB РФ"), true, "тот же шаблон в SQL");
  assert.equal(new RegExp(WB_WAREHOUSE_SQL_PATTERN, "i").test("Коледино"), false);
  assert.equal(STOCK_SNAPSHOT_HOUR_MSK, 23, "остаток на конец дня — снимок 23:00 по Москве");
});

test("текущий остаток артикула — только «Склад WB», а «в пути» — по всем строкам", () => {
  const [row] = buildLightweightProductTotals([{ nm_id: 1 }], [
    { nm_id: 1, warehouse: "Склад WB РФ", quantity: 100 },
    { nm_id: 1, warehouse: "Коледино", quantity: 500 },
    { nm_id: 1, warehouse: "Казань", quantity: 40 },
    { nm_id: 1, warehouse: "В пути до получателей", quantity: 0, in_way_to_client: 7 },
    { nm_id: 1, warehouse: "В пути возвраты на склад WB", quantity: 0, in_way_from_client: 3 },
  ]);
  assert.equal(row.stock, 100, "фантом складов по городам в остаток не идёт");
  assert.equal(row.in_way_to_client, 7);
  assert.equal(row.in_way_from_client, 3);
});

test("строки без названия склада считаются целиком, как раньше", () => {
  const [row] = buildLightweightProductTotals([], [{ nm_id: 1, quantity: 7 }]);
  assert.equal(row.stock, 7);
});

// ── Ответ функции и ряд по дням ──────────────────────────────────────────────

const raw = {
  hour: 23,
  covered: ["2026-09-10", "2026-09-11", "2026-09-12"],
  byNm: { "1": { "2026-09-10": [100, 7, 0], "2026-09-11": [80, 0, 2] }, "2": { "2026-09-10": [0, 0, 0] } },
};

test("ответ функции разбирается в остатки по артикулам и дням", () => {
  const history = parseStockHistory(raw)!;
  assert.equal(history.hour, 23);
  assert.deepEqual([...history.covered], ["2026-09-10", "2026-09-11", "2026-09-12"]);
  assert.deepEqual(history.byNm.get(1)!.get("2026-09-11"), { stock: 80, inWayToClient: 0, inWayFromClient: 2 });
  assert.equal(parseStockHistory(null), null);
  assert.equal(parseStockHistory({ covered: "нет" }), null, "мусор вместо ответа — не история");
});

test("ряд артикула: снимок дня, ноль там, где снимок был, а артикула в нём нет; деньги — по себестоимости", () => {
  const series = stockSeriesForSku(parseStockHistory(raw)!, 1, 500, "2026-09-21");
  assert.deepEqual(series.byDate.get("2026-09-10"), { stock: 100, inWayToClient: 7, inWayFromClient: 0, money: 50_000 });
  assert.deepEqual(series.byDate.get("2026-09-12"), { stock: 0, inWayToClient: 0, inWayFromClient: 0, money: 0 }, "12.09 снимок был, артикула нет — остаток нулевой");
  const noCost = stockSeriesForSku(parseStockHistory(raw)!, 1, 0, "2026-09-21");
  assert.equal(noCost.byDate.get("2026-09-10")!.money, null, "остаток есть, себестоимости нет — деньги неизвестны, а не ноль");
  assert.equal(noCost.byDate.get("2026-09-12")!.money, 0);
});

test("ряд по дням периода: сегодня — живой остаток, день со снимком — снимок, день без снимка — пусто", () => {
  const series = stockSeriesForSku(parseStockHistory(raw)!, 1, 500, "2026-09-13");
  const days = ["2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13"];
  assert.deepEqual(stockDailySeries(days, series, 55, (day) => day.stock), [null, 100, 80, 0, 55]);
  assert.deepEqual(stockDailySeries(days, series, null, (day) => day.money), [null, 50_000, 40_000, 0, null], "деньги сегодня неизвестны — так и остаётся");
});

test("сводка: остатки артикулов складываются по дням, деньги — остаток × себестоимость", () => {
  const history = parseStockHistory(raw)!;
  const summary = stockSeriesForSummary(history, [1, 2, 3], new Map([[1, 500], [2, null]]), "2026-09-21");
  assert.deepEqual(summary.byDate.get("2026-09-10"), { stock: 100, inWayToClient: 7, inWayFromClient: 0, money: 50_000 });
  assert.equal(summary.byDate.get("2026-09-12")!.stock, 0);
});

test("кабинеты сводки складываются по артикулу и дню; без истории у одного — нет её у всех", () => {
  const a = parseStockHistory(raw)!;
  const b = parseStockHistory({ hour: 23, covered: ["2026-09-10", "2026-09-14"], byNm: { "1": { "2026-09-10": [10, 1, 1] }, "5": { "2026-09-14": [4, 0, 0] } } })!;
  const merged = mergeStockHistories([a, b])!;
  assert.deepEqual(merged.byNm.get(1)!.get("2026-09-10"), { stock: 110, inWayToClient: 8, inWayFromClient: 1 });
  assert.deepEqual([...merged.covered].sort(), ["2026-09-10", "2026-09-11", "2026-09-12", "2026-09-14"]);
  assert.equal(mergeStockHistories([a, null]), null);
  assert.equal(mergeStockHistories([]), null);
  assert.deepEqual([...mergeStockHistories([a, emptyStockHistory()])!.covered].sort(), [...a.covered].sort(), "пустой кабинет истории сводки не гасит");
});

// ── Загрузка ─────────────────────────────────────────────────────────────────

const fakeDb = (reply: { data?: unknown; error?: { code?: string; message: string } | null }) => {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  return { db: { rpc: async (fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return { data: reply.data ?? null, error: reply.error ?? null }; } } as unknown as SupabaseClient, calls };
};

test("история читается функцией на фиксированный час, с кабинетом и списком артикулов", async () => {
  const { db, calls } = fakeDb({ data: raw });
  const history = await loadStockHistory(db, { cabinetId: "cab", from: "2026-09-01", to: "2026-09-21", nmIds: [1, 2] });
  assert.ok(history);
  assert.deepEqual(calls[0], { fn: "wb_stock_history_daily", args: { p_cabinet: "cab", p_from: "2026-09-01", p_to: "2026-09-21", p_hour: 23, p_nm_ids: [1, 2] } });
});

test("нет функции — тихий откат к остатку-точке; прочая ошибка — наверх, чтобы попасть в заметки РНП", async () => {
  const missing = fakeDb({ error: { code: "PGRST202", message: "Could not find the function" } });
  assert.equal(await loadStockHistory(missing.db, { cabinetId: null, from: "a", to: "b", nmIds: null }), null);
  const broken = fakeDb({ error: { code: "57014", message: "statement timeout" } });
  await assert.rejects(() => loadStockHistory(broken.db, { cabinetId: null, from: "a", to: "b", nmIds: null }), /statement timeout/);
});

// ── Метрики РНП ──────────────────────────────────────────────────────────────

const DAYS = ["2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13"];
const CUTOFFS = { orders: "2026-09-13", sales: "2026-09-13", adverts: "2026-09-13" };
const day = (d: string, buyouts: number) => ({ d, orders_count: buyouts, orders_sum: buyouts * 1000, buyouts_count: buyouts, buyouts_sum: buyouts * 1000, ad_spent: 0 });
const byDate = new Map(DAYS.map((d) => [d, day(d, 10)]));
const metrics = (series: ReturnType<typeof stockSeriesForSku> | null) => buildMetrics(DAYS, "2026-09-13", byDate, 55, 27_500, CUTOFFS, 500, null, 30, { inWayToClient: 4, inWayFromClient: 1, stockSeries: series });
const find = (list: ReturnType<typeof metrics>, field: string) => list.find((item) => item.field === field)!;

test("РНП: остаток, «в пути» и деньги в остатках заполнены по дням, сегодня — живой остаток", () => {
  const list = metrics(stockSeriesForSku(parseStockHistory(raw)!, 1, 500, "2026-09-13"));
  assert.deepEqual(find(list, "stock").daily, [null, 100, 80, 0, 55]);
  assert.deepEqual(find(list, "stock_in_way_to_client").daily, [null, 7, 0, 0, 4]);
  assert.deepEqual(find(list, "stock_in_way_from_client").daily, [null, 0, 2, 0, 1]);
  assert.deepEqual(find(list, "stock_total").daily, [null, 107, 82, 0, 60]);
  assert.deepEqual(find(list, "money").daily, [null, 50_000, 40_000, 0, 27_500]);
  assert.equal(find(list, "stock").total, 55, "итог — текущий остаток, как раньше");
});

test("РНП: оборачиваемость дня — остаток дня / средние дневные выкупы", () => {
  const list = metrics(stockSeriesForSku(parseStockHistory(raw)!, 1, 500, "2026-09-13"));
  // 10 выкупов в день: остаток 100 — 10 дней, 80 — 8, 0 — 0, сегодня 55 — 6 (5,5 округляется).
  assert.deepEqual(find(list, "turnover").daily, [null, 10, 8, 0, 6]);
});

test("РНП: GMROI остаётся точкой, а описание метрики называет источник и час", () => {
  const list = metrics(stockSeriesForSku(parseStockHistory(raw)!, 1, 500, "2026-09-13"));
  assert.equal(find(list, "gmroi").daily.filter((value) => value != null).length <= 1, true);
  const note = find(list, "stock").note ?? "";
  assert.match(note, /23:00 по Москве/);
  assert.match(note, /«Склад WB»/);
  assert.match(note, /в дни без снимка ячейка пуста/);
});

test("РНП без истории — прежняя точка в дате факта, ничего не выдумывается", () => {
  const list = metrics(null);
  assert.deepEqual(find(list, "stock").daily, [null, null, null, null, 55]);
  assert.match(find(list, "stock").note ?? "", /Текущий снимок показан в дате факта/);
});

// ── Порядок и границы ────────────────────────────────────────────────────────

test("миграция: снимок на фиксированный час, только успешные запуски и только «Склад WB»", () => {
  const sql = read("../supabase/migrations/202609220002_wb_stock_history_daily.sql");
  assert.match(sql, /s\.job = 'stocks-history'\s+and s\.status = 'ok'/, "неудавшийся запуск мог записать часть строк");
  assert.match(sql, /<= p_hour/);
  assert.match(sql, /~\* '\^склад\\s\+\(wb\|вб\)'/);
  assert.match(sql, /set plan_cache_mode = force_custom_plan/);
  assert.match(sql, /returns jsonb/, "PostgREST режет набор строк на тысяче — ответ одним jsonb");
});

test("все места, где читаются остатки WB, знают склад строки", () => {
  const source = read("../lib/rnp/buildTable.ts");
  assert.equal((source.match(/\.select\("nm_id, warehouse, quantity, in_way_to_client, in_way_from_client"\)/g) ?? []).length, 2);
  assert.doesNotMatch(source, /\.select\("nm_id, quantity, in_way_to_client, in_way_from_client"\)/, "чтение без склада вернуло бы в остаток фантом");
  assert.match(source, /mergeStockHistories\(scopeData\.map/);
  assert.match(source, /stockSeries: stockHistory \? stockSeriesForSku\(/);
  assert.match(source, /stockSeries: stockHistory \? stockSeriesForSummary\(/);
});
