import { strict as assert } from "node:assert";
import test from "node:test";

/**
 * РНП целиком: настоящий buildRnpTable поверх поддельного PostgREST (глобальный
 * fetch). Юнит-тесты проверяют функции по отдельности, а этот — их проводку:
 * прогноз продаж из якоря, «Корзина → заказ» сводки, воронку «в пути»,
 * границы свежести ступеней прибыли, отзывы по кабинетам и московским суткам.
 *
 * Два кабинета: «Оптима» — со списком артикулов, воронкой и когортой по srid;
 * CLERIN — без списка, воронка посреди круга (успешный проход вчера, строк за
 * период нет). В «Все кабинеты» отзывы Оптимы не читаются (таймаут базы).
 */

const MSK = 3 * 3_600_000;
// Сборка и данные должны видеть одни и те же «сегодня» по Москве.
while (new Date(Date.now() + MSK).toISOString().slice(11, 19) > "23:59:40") {
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://fake-supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
// Раннер CI — Node 20, глобального WebSocket там нет, а supabase-js ищет его уже
// в createClient (realtime-js берёт транспорт в конструкторе) и падает. Стенду
// realtime не нужен: заглушка лишь даёт создать клиент, а открыть сокет не даёт.
globalThis.WebSocket ??= class {
  constructor() { throw new Error("стенд РНП не открывает realtime-сокеты"); }
} as unknown as typeof WebSocket;

const today = new Date(Date.now() + MSK).toISOString().slice(0, 10);
const shift = (day: string, n: number) => { const date = new Date(`${day}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + n); return date.toISOString().slice(0, 10); };
const yesterday = shift(today, -1);
const from = shift(today, -6);
const to = today;

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
const add = (table: string, row: Row) => { (tables[table] ??= []).push(row); };
let scenario: "single" | "all" = "single";

add("wb_cabinets", { id: "cab-a", name: "Оптима", trade_mark: null, seller_id: null, inn: null, token: "t", token_advert: "t", token_content: "t", token_feedbacks: "t", brand_filters: null, is_active: true, marketplace: "wb", created_at: "2026-01-01T00:00:00Z" });
add("wb_cabinets", { id: "cab-b", name: "CLERIN", trade_mark: null, seller_id: null, inn: null, token: "t", token_advert: "t", token_content: "t", token_feedbacks: "t", brand_filters: null, is_active: true, marketplace: "wb", created_at: "2026-02-01T00:00:00Z" });
for (const nm of [101, 102]) add("wb_cabinet_product_scope", { cabinet_id: "cab-a", nm_id: nm });
// 202 — карточка CLERIN без фактов за период: артикул только из каталога.
for (const [cabinet, article, nm] of [["cab-a", "A-101", 101], ["cab-a", "A-102", 102], ["cab-b", "B-201", 201], ["cab-b", "B-202", 202]] as const) {
  add("wb_cards", { cabinet_id: cabinet, nm_id: nm, article, name: article, brand: "x", subject: "y" });
  add("product_costs", { article, name: article, cost_rub: 400, brand: "x", category: "y" });
}
for (const nm of [101, 102, 201]) add("wb_nm_commissions", { cabinet_id: nm === 201 ? "cab-b" : "cab-a", nm_id: nm, pct: 20, acq_pct: 2, extra_pct: 10, rev: 100_000, delivery_pct: 5, storage_pct: 2, penalty_pct: 1, acceptance_pct: 1, deduction_pct: 1 });

const synced = (at: string, extra: Row = {}) => ({ cursor: null, status: "caught_up", attempts: 0, last_error: null, state: { caughtUp: true, lastSyncedAt: at, ...extra }, updated_at: at });
for (const job of ["orders", "sales"]) {
  add("wb_sync_state", { cabinet_id: "cab-a", job, ...synced(`${today}T03:00:00Z`) });
  add("wb_sync_state", { cabinet_id: "cab-b", job, ...synced(`${today}T03:00:00Z`) });
}
// Реклама отстаёт от продаж на три дня.
add("wb_sync_state", { cabinet_id: "cab-a", job: "advert-stats", ...synced(`${shift(today, -3)}T03:00:00Z`) });
add("wb_sync_state", { cabinet_id: "cab-a", job: "funnel", ...synced(`${today}T03:00:00Z`, { lastPeriod: { end: yesterday } }) });
add("wb_sync_state", { cabinet_id: "cab-b", job: "funnel", cursor: null, status: "pending", attempts: 0, last_error: null, state: { coveragePct: 33.3, lastSyncedAt: `${yesterday}T12:00:00Z` }, updated_at: `${yesterday}T12:00:00Z` });

const rpcData: Record<string, Row[]> = { rnp_scoped_daily_sku: [], rnp_daily_sku: [] };
for (let d = from; d <= to; d = shift(d, 1)) {
  for (const nm of [101, 102]) {
    rpcData.rnp_scoped_daily_sku.push({ d, nm_id: nm, article: `A-${nm}`, orders_count: 10, orders_sum: 10_000, orders_gross_sum: 12_000, cancels_count: 2, cancels_sum: 2_000, orders_fbs_count: 0, orders_fbs_sum: 0, orders_fbw_count: 10, orders_fbw_sum: 10_000, buyouts_count: 5, buyouts_sum: 5_000, buyouts_gross_sum: 5_000, buyouts_finished_sum: 4_800, ad_spent: 300 });
    if (d <= yesterday) add("wb_funnel_daily", { cabinet_id: "cab-a", nm_id: nm, date: d, open_card: 200, add_to_cart: 50, add_to_wishlist: 5, orders: 10, orders_sum: 10_000 });
    if (d <= shift(today, -3)) add("wb_advert_nm_daily", { cabinet_id: "cab-a", nm_id: nm, date: d, views: 1000, clicks: 77, spent: 300, orders: 3, orders_sum: 3_000 });
  }
  rpcData.rnp_daily_sku.push({ d, nm_id: 201, orders_count: 30, orders_sum: 30_000, buyouts_count: 10, buyouts_sum: 10_000, ad_spent: 0 });
}

// Когорта Оптимы: 20 заказов в день на артикул, 4 отменены, 12 выкуплены, 4 в пути —
// ставка выкупа 12 / (12 + 4) = 75% у обоих артикулов.
let id = 0;
for (let back = 45; back >= 0; back--) {
  const day = shift(today, -back);
  for (const nm of [101, 102]) {
    for (let index = 0; index < 20; index++) {
      id += 1;
      const cancel = index < 4;
      add("wb_orders", { id, cabinet_id: "cab-a", nm_id: nm, srid: `s${id}`, date: `${day}T10:00:00+00:00`, is_cancel: cancel });
      if (!cancel && index < 16 && back >= 2) add("wb_sales", { id, cabinet_id: "cab-a", nm_id: nm, srid: `s${id}`, sale_id: `S${id}`, date: `${shift(day, 2)}T10:00:00+00:00` });
    }
  }
}

// Отзывы CLERIN: 5★ с пустыми строками в 01:30 МСК первого дня (22:30 UTC накануне)
// и 3★ с текстом в полдень того же дня. WB хранит отсутствие текста как "".
add("wb_feedbacks", { cabinet_id: "cab-b", nm_id: 201, rating: 5, created_at_wb: `${shift(from, -1)}T22:30:00+00:00`, review_text: "", pros: "", cons: "" });
add("wb_feedbacks", { cabinet_id: "cab-b", nm_id: 201, rating: 3, created_at_wb: `${from}T12:00:00+00:00`, review_text: "так себе", pros: "", cons: "" });
add("wb_feedbacks", { cabinet_id: "cab-a", nm_id: 101, rating: 4, created_at_wb: `${from}T12:00:00+00:00`, review_text: "", pros: "", cons: "" });

// ── поддельный PostgREST ──
const asTime = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? Date.parse(value.length === 10 ? `${value}T00:00:00Z` : value) : NaN;
const cmp = (a: unknown, b: string) => {
  const ta = asTime(a), tb = asTime(b);
  if (Number.isFinite(ta) && Number.isFinite(tb)) return ta - tb;
  const na = Number(a), nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return String(a).localeCompare(b);
};
function applyFilter(rows: Row[], column: string, expr: string): Row[] {
  const [op, ...rest] = expr.split(".");
  const value = rest.join(".");
  if (op === "eq") return rows.filter((row) => String(row[column]) === value);
  if (op === "neq") return rows.filter((row) => String(row[column]) !== value);
  if (op === "gte") return rows.filter((row) => cmp(row[column], value) >= 0);
  if (op === "gt") return rows.filter((row) => cmp(row[column], value) > 0);
  if (op === "lte") return rows.filter((row) => cmp(row[column], value) <= 0);
  if (op === "lt") return rows.filter((row) => cmp(row[column], value) < 0);
  if (op === "in") {
    const list = value.replace(/^\(|\)$/g, "").split(",").map((item) => item.replace(/^"|"$/g, ""));
    return rows.filter((row) => list.includes(String(row[column])));
  }
  if (op === "is") return rows.filter((row) => value === "null" ? row[column] == null : String(row[column]) === value);
  if (op === "not" && rest[0] === "is") return rows.filter((row) => rest[1] === "null" ? row[column] != null : String(row[column]) !== rest[1]);
  return rows;
}
const RESERVED = new Set(["select", "order", "offset", "limit", "columns"]);
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.host !== "fake-supabase.test") return new Response("", { status: 404 });
  const method = (init?.method ?? "GET").toUpperCase();
  const path = url.pathname.replace(/^\/rest\/v1\//, "");
  let rows: Row[];
  if (path.startsWith("rpc/")) {
    const fn = path.slice(4);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (fn === "rnp_sales_srid_since") return json("2026-01-01");
    rows = (rpcData[fn] ?? [])
      .filter((row) => fn === "rnp_scoped_daily_sku" ? body.p_cabinet === "cab-a" : fn === "rnp_daily_sku" ? body.p_cabinet === "cab-b" : true)
      .filter((row) => !body.p_from || cmp(row.d, body.p_from) >= 0)
      .filter((row) => !body.p_to || cmp(row.d, body.p_to) <= 0);
  } else {
    if (path === "wb_feedbacks" && scenario === "all" && url.searchParams.get("cabinet_id") === "eq.cab-a") {
      return json({ message: "canceling statement due to statement timeout", code: "57014" }, 500);
    }
    rows = [...(tables[path] ?? [])];
  }
  for (const [key, value] of url.searchParams) if (!RESERVED.has(key)) rows = applyFilter(rows, key, value);
  const order = url.searchParams.get("order");
  if (order) {
    const specs = order.split(",").map((spec) => { const [column, direction] = spec.split("."); return { column, desc: direction === "desc" }; });
    rows.sort((a, b) => { for (const { column, desc } of specs) { const c = cmp(a[column], String(b[column])); if (c) return desc ? -c : c; } return 0; });
  }
  const total = rows.length;
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const limit = url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : 1_000;
  rows = rows.slice(offset, offset + Math.min(limit, 1_000));
  const select = url.searchParams.get("select");
  if (select && select !== "*") {
    const columns = select.split(",").map((column) => column.trim());
    rows = rows.map((row) => Object.fromEntries(columns.map((column) => [column, row[column]])));
  }
  const headers = { "content-range": `${offset}-${offset + rows.length - 1}/${total}` };
  if (method === "HEAD") return new Response(null, { status: 200, headers });
  return json(rows, 200, headers);
}) as typeof fetch;

const { buildRnpTable } = await import("../lib/rnp/buildTable");
const { composeRnpSummaryFromSkus } = await import("../lib/rnp/summaryFromSkus");

interface M { field: string; kind: string; daily: (number | null)[]; total: number | null; forecast: number | null; status?: string; qualityReason?: string; note?: string; parts?: { numerator: (number | null)[]; denominator: (number | null)[]; scale: 100 | 1 } }
interface Table { summary: M[]; skus: Array<{ nm: number; metrics: M[] }> }
const build = async (which: "single" | "all"): Promise<Table> => {
  scenario = which;
  const table = await buildRnpTable(from, to, which === "single" ? "cab-a" : null, which === "single" ? "Оптима" : "Все кабинеты");
  assert.ok(!("error" in table), String((table as { error?: string }).error));
  return table as unknown as Table;
};
const single = await build("single");
const all = await build("all");
const pick = (list: M[], field: string) => { const metric = list.find((item) => item.field === field); assert.ok(metric, `нет строки ${field}`); return metric; };
const sku = (table: Table, nm: number) => { const found = table.skus.find((item) => item.nm === nm); assert.ok(found, `нет артикула ${nm}`); return found; };
const sumSkus = (table: Table, field: string, index: number) => table.skus.reduce((total, item) => total + (item.metrics.find((metric) => metric.field === field)?.daily[index] ?? 0), 0);
const lastIndex = 6;

test("прогноз продаж: заказы × ставка якоря; на дне из Статистики база с отменами; сводка = Σ артикулов", () => {
  const expected = pick(single.summary, "expected_buyouts_count");
  // Дни воронки: 2 артикула × 10 заказов × 75%; сегодня (Статистика): (10 + 2 отмены) × 75%.
  assert.deepEqual(expected.daily.slice(0, lastIndex), [15, 15, 15, 15, 15, 15]);
  assert.equal(expected.daily[lastIndex], 18);
  assert.equal(expected.total, 108);
  for (let index = 0; index <= lastIndex; index++) assert.equal(sumSkus(single, "expected_buyouts_count", index), expected.daily[index]);
  assert.match(expected.note ?? "", /Ставка кабинета — 75%/);
  assert.equal(pick(single.summary, "expected_buyout_pct").total, 75);
});

test("«Все кабинеты»: прогноз сводки молчит, у артикулов со ставкой — есть; под фильтром по ним — с их пояснением", () => {
  const expected = pick(all.summary, "expected_buyouts_count");
  assert.equal(expected.total, null);
  assert.equal(expected.qualityReason, "unsupported_source");
  assert.ok((pick(sku(all, 101).metrics, "expected_buyouts_count").total ?? 0) > 0);
  const filtered = composeRnpSummaryFromSkus(all.summary, all.skus.filter((item) => item.nm === 101 || item.nm === 102), 7);
  const row = pick(filtered, "expected_buyouts_count");
  assert.equal(row.total, 108);
  assert.notEqual(row.qualityReason, "unsupported_source");
  assert.doesNotMatch(row.note ?? "", /Ставки выкупа нет/);
});

test("«Корзина → заказ»: сегодня без воронки молчит; кабинет с воронкой «в пути» гасит сводку, а не отдаёт чужую конверсию", () => {
  const single_ = pick(single.summary, "cart_order_cr");
  assert.deepEqual(single_.daily.slice(0, lastIndex), [20, 20, 20, 20, 20, 20]);
  assert.equal(single_.daily[lastIndex], null);
  const all_ = pick(all.summary, "cart_order_cr");
  assert.deepEqual(all_.daily, [null, null, null, null, null, null, null], "CLERIN: воронка жива, корзины неизвестны");
  assert.deepEqual(pick(sku(all, 201).metrics, "cart_order_cr").parts?.numerator, [null, null, null, null, null, null, null]);
});

test("ступени прибыли сводки идут по дням продаж, хотя реклама отстаёт; сводка = Σ артикулов; при полной себестоимости — без «нет себестоимости»", () => {
  for (const field of ["gross_profit", "profit_before_ads"]) {
    const row = pick(single.summary, field);
    assert.ok(row.daily.every((value) => value != null), `${field}: все дни продаж`);
    for (let index = 0; index <= lastIndex; index++) assert.equal(row.daily[index], sumSkus(single, field, index), `${field}, день ${index}`);
  }
  assert.equal(pick(single.summary, "gross").daily[lastIndex], null, "а прибыль после рекламы за дни без рекламы молчит");
  assert.equal(pick(single.summary, "gross_profit").qualityReason, undefined);
  assert.equal(pick(single.summary, "gross_margin_pct").qualityReason, undefined);
});

test("отзывы: московские сутки, пустые строки — не текст; сбой чтения по кабинету — «—», в том числе у артикулов только из каталога", () => {
  const clerin = sku(all, 201).metrics;
  assert.equal(pick(clerin, "reviews_count").daily[0], 2, "22:30 UTC накануне — это 01:30 МСК первого дня");
  assert.equal(pick(clerin, "reviews_text_count").daily[0], 1, "5★ с пустыми строками — без текста");
  assert.equal(pick(clerin, "reviews_text_rating").daily[0], 3);
  assert.equal(pick(clerin, "reviews_text_bad_share_pct").daily[0], 100);
  for (const nm of [101, 102]) {
    const row = pick(sku(all, nm).metrics, "reviews_count");
    assert.equal(row.total, null);
    assert.equal(row.qualityReason, "api_error");
  }
  assert.equal(pick(all.summary, "reviews_count").total, null);
  const cardOnly = pick(sku(all, 202).metrics, "reviews_count");
  assert.equal(cardOnly.total, null, "артикул только из каталога: кабинет неизвестен — «—», а не «0 оценок»");
  assert.equal(cardOnly.qualityReason, "api_error");
  // Один кабинет, отзывы прочитались: у Оптимы 1 оценка без текста в первый день.
  assert.equal(pick(sku(single, 101).metrics, "reviews_count").daily[0], 1);
  assert.equal(pick(sku(single, 101).metrics, "reviews_text_count").daily[0], 0);
});
