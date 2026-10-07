import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ENGINE_KIND, ENGINE_KIND_LABEL, isEngineKind } from "../lib/assortment/engineBudget.ts";
import { China1688Error } from "../lib/assortment/china1688.ts";
import { cha88Payload, readSupplierStream, type FactoryCallers } from "../lib/assortment/factories1688.ts";
import {
  cacheable, candidateRelay, composeQuery, FACTORY_CALLS_PER_SEARCH, FACTORY_DAILY_CALLS, FACTORY_QUERY_PROMPT, FACTORY_UNVERIFIED_NOTE, FACTORY_USAGE_KIND, factoryCapRefusal,
  factoryQueryKey, factoryTranslatorFromEnv, normalizeQueryZh, NO_USAGE_WORDS, runCompanyRisk, runCompanySearch, runFactorySearch, translateFactoryQuery,
} from "../lib/assortment/factorySearch.ts";
import {
  addToShortlist, canEditFactories, checklistValue, contactProblem, factoriesTab, FACTORY_CHECKLIST, FACTORY_EDIT_ROLES, FACTORY_MIGRATION_WORDS, FACTORY_STATUSES, loadShortlist,
  patchShortlist, saveRegistryCheck,
} from "../lib/assortment/factoryShortlist.ts";
import type { TranslateSetup } from "../lib/assortment/chinaSync.ts";
import type { FactoryCard } from "../lib/assortment/factoryCards.ts";

/**
 * «Фабрики сумок (1688)» — поиск (ключ, запрос, кэш на 7 дней, учёт и потолки запросов, два источника), перевод запроса, проверка
 * компании (88查), шорт-лист (права, статусы с историей, чек-лист, заметки без контактов) на подставной базе: она применяет фильтры и
 * порядок, режет страницу на 1 000 строк, сверяет колонки с миграцией 202610070010 и держит её ограничения (юрлицо / псевдоним, код только
 * у юрлица, отклонение с причиной, уникальный ключ фабрики, срок кэша).
 */

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(join(root, path), "utf8");
const FIX = "tests/fixtures/assortment-factories";
const text = (name: string) => read(`${FIX}/${name}`);
const PRODUCTS = JSON.parse(text("find-product-factories-bags.json")).data as unknown;
const sql = read("supabase/migrations/202610070010_assortment_cn_factories.sql");

const ENV = { ALI_1688_AK: Buffer.from(`${"T".repeat(32)}testkeyid000000001`, "utf8").toString("base64url") };
const NOW = Date.parse("2026-10-07T09:00:00Z"); // 12:00 МСК
const DAY = 24 * 3600 * 1000;
const TODAY = "2026-10-07";
const WHO = "buyer@example.test";
const PEOPLE = ["张测试", "王测试", "李测试", "陈测试", "李明", "13800000000", "test@example.com", "白沟新城华美箱包厂", "深圳市福田区优品服饰商行"];

// ---------------------------------------------------------------------------
// Подставная база

type Row = Record<string, unknown>;
const POSTGREST_MAX_ROWS = 1000;

function migrationColumns(table: string): Set<string> {
  const block = new RegExp(`create table if not exists public\\.${table} \\(([\\s\\S]*?)\\n\\);`).exec(sql)?.[1] ?? "";
  return new Set(block.split("\n").map((l) => /^\s{2}([a-z_0-9]+)\s+/.exec(l)?.[1]).filter((c): c is string => Boolean(c) && c !== "primary" && c !== "check"));
}

const COLUMNS: Record<string, Set<string>> = {
  assortment_cn_factory_search: migrationColumns("assortment_cn_factory_search"),
  assortment_cn_factory: migrationColumns("assortment_cn_factory"),
  assortment_ai_usage: new Set(["day", "kind", "calls", "failed_calls", "input_tokens", "output_tokens", "cost_usd", "updated_at"]),
};

/** Ограничения миграции 202610070010, которые код обязан соблюдать сам. */
function violates(table: string, row: Row): string | null {
  if (table === "assortment_cn_factory") {
    const company = row.entity === "company";
    if (!["company", "individual", "unknown"].includes(String(row.entity))) return "entity";
    if (company ? row.company_name == null : row.company_name != null || row.pseudonym == null) return "юрлицо — название, остальные — псевдоним";
    if (row.credit_code != null && (!company || !/^[0-9A-Z]{18}$/.test(String(row.credit_code)))) return "код — только у юрлица";
    if (row.pseudonym != null && !/^Фабрика [0-9]{1,5}$/.test(String(row.pseudonym))) return "псевдоним";
    if (row.shop_url != null && !/^https:\/\/([a-z0-9-]+\.)*1688\.com(\/|$)/.test(String(row.shop_url))) return "shop_url";
    if (!(FACTORY_STATUSES as readonly string[]).includes(String(row.status ?? "candidate"))) return "status";
    if (row.status === "rejected" && row.reject_reason == null) return "отклонение без причины";
    if (row.direction != null && row.direction !== "bags") return "direction";
  }
  if (table === "assortment_cn_factory_search") {
    if (!/^[0-9a-f]{64}$/.test(String(row.query_key))) return "query_key";
    const created = Date.parse(String(row.created_at));
    const expires = Date.parse(String(row.expires_at));
    if (!(expires > created && expires <= created + 7 * DAY + 60_000)) return "срок кэша";
    if (String(row.query_zh).length > 80) return "query_zh";
  }
  return null;
}

const KEYS: Record<string, string[]> = { assortment_ai_usage: ["day", "kind"], assortment_cn_factory: ["factory_key"], assortment_cn_factory_search: ["id"] };

interface FakeInit {
  tables?: Record<string, Row[]>;
  missing?: string[];
  /** После чтения таблицы — «другой человек успел записать» (для проверки сравнения-и-замены). */
  afterSelect?: (table: string, tables: Record<string, Row[]>) => void;
}

function fakeDb(init: FakeInit = {}) {
  const tables: Record<string, Row[]> = { assortment_ai_usage: [], assortment_cn_factory_search: [], assortment_cn_factory: [], ...(init.tables ?? {}) };
  const missing = new Set(init.missing ?? []);
  const log: Array<{ table: string; op: string }> = [];
  const hooks = { afterSelect: init.afterSelect };
  const badColumn = (table: string, row: Row) => {
    const allowed = COLUMNS[table];
    const bad = allowed ? Object.keys(row).filter((c) => !allowed.has(c)) : [];
    return bad.length ? { code: "PGRST204", message: `Could not find the '${bad[0]}' column of '${table}' in the schema cache` } : null;
  };
  class Query {
    private filters: Array<(r: Row) => boolean> = [];
    private orders: Array<[string, boolean]> = [];
    private op: "select" | "update" | "insert" | "delete" = "select";
    private values: Row = {};
    private returning = false;
    private rangeV: [number, number] | null = null;
    private limitV: number | null = null;
    constructor(private table: string) {}
    select() {
      if (this.op !== "select") this.returning = true;
      return this;
    }
    eq(c: string, v: unknown) { this.filters.push((r) => r[c] === v); return this; }
    gt(c: string, v: unknown) { this.filters.push((r) => r[c] != null && String(r[c]) > String(v)); return this; }
    gte(c: string, v: unknown) { this.filters.push((r) => r[c] != null && String(r[c]) >= String(v)); return this; }
    lt(c: string, v: unknown) { this.filters.push((r) => r[c] != null && String(r[c]) < String(v)); return this; }
    in(c: string, vs: unknown[]) { this.filters.push((r) => vs.includes(r[c])); return this; }
    is(c: string, v: unknown) { this.filters.push((r) => (r[c] ?? null) === v); return this; }
    not(c: string, operator: string, v: unknown) {
      if (operator !== "is" || v !== null) throw new Error(`подставка: not(${operator})`);
      this.filters.push((r) => r[c] != null);
      return this;
    }
    order(c: string, o: { ascending?: boolean } = {}) { this.orders.push([c, o.ascending !== false]); return this; }
    limit(n: number) { this.limitV = n; return this; }
    range(a: number, b: number) { this.rangeV = [a, b]; return this; }
    update(v: Row) { this.op = "update"; this.values = v; return this; }
    delete() { this.op = "delete"; return this; }
    insert(row: Row) { this.op = "insert"; this.values = row; return this; }
    maybeSingle() {
      const res = this.exec();
      return Promise.resolve(res.error ? res : { data: (res.data as Row[])[0] ?? null, error: null });
    }
    then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
      return Promise.resolve(this.exec()).then(resolve, reject);
    }
    private rows() {
      return (tables[this.table] ?? []).filter((r) => this.filters.every((f) => f(r)));
    }
    private exec(): { data: unknown; error: { code?: string; message: string } | null } {
      const table = this.table;
      if (missing.has(table)) return { data: null, error: { code: "42P01", message: `relation "public.${table}" does not exist` } };
      if (this.op === "insert") {
        const err = badColumn(table, this.values);
        if (err) return { data: null, error: err };
        const v = violates(table, this.values);
        if (v) return { data: null, error: { code: "23514", message: `check: ${v}` } };
        const k = KEYS[table];
        if (k && (tables[table] ?? []).some((r) => k.every((c) => r[c] === this.values[c]))) return { data: null, error: { code: "23505", message: "duplicate key" } };
        (tables[table] ??= []).push(structuredClone(this.values));
        log.push({ table, op: "insert" });
        return { data: null, error: null };
      }
      if (this.op === "update") {
        const err = badColumn(table, this.values);
        if (err) return { data: null, error: err };
        const hit = this.rows();
        for (const r of hit) {
          const v = violates(table, { ...r, ...this.values });
          if (v) return { data: null, error: { code: "23514", message: `check: ${v}` } };
        }
        for (const r of hit) Object.assign(r, structuredClone(this.values));
        log.push({ table, op: "update" });
        return { data: this.returning ? hit.map((r) => ({ ...r })) : null, error: null };
      }
      if (this.op === "delete") {
        const hit = new Set(this.rows());
        tables[table] = (tables[table] ?? []).filter((r) => !hit.has(r));
        log.push({ table, op: "delete" });
        return { data: null, error: null };
      }
      log.push({ table, op: "select" });
      let list = this.rows().map((r) => structuredClone(r));
      hooks.afterSelect?.(table, tables);
      for (const [c, asc] of [...this.orders].reverse()) list.sort((a, b) => (String(a[c] ?? "") < String(b[c] ?? "") ? -1 : String(a[c] ?? "") > String(b[c] ?? "") ? 1 : 0) * (asc ? 1 : -1));
      if (this.rangeV) list = list.slice(this.rangeV[0], Math.min(this.rangeV[1] + 1, this.rangeV[0] + POSTGREST_MAX_ROWS));
      else list = list.slice(0, Math.min(this.limitV ?? POSTGREST_MAX_ROWS, POSTGREST_MAX_ROWS));
      return { data: list, error: null };
    }
  }
  return { db: { from: (table: string) => new Query(table) } as never, tables, log, missing, hooks };
}

// ---------------------------------------------------------------------------
// Подставной 1688

type Fail = Partial<Record<keyof FactoryCallers, Error>>;

function fakeCallers(fail: Fail = {}) {
  const served: Array<{ skill: keyof FactoryCallers; arg: string }> = [];
  const run = async <T,>(skill: keyof FactoryCallers, arg: string, value: () => T): Promise<T> => {
    served.push({ skill, arg });
    if (fail[skill]) throw fail[skill];
    return value();
  };
  const callers: FactoryCallers = {
    suppliers: (q) => run("suppliers", q, () => readSupplierStream(text("source-suppliers-single-json.txt"))),
    products: (q) => run("products", q, () => PRODUCTS),
    companySearch: (n) => run("companySearch", n, () => cha88Payload(text("cha88-company-search.json"))),
    companyRisk: (c) => run("companyRisk", c, () => cha88Payload(text("cha88-company-risk.json"))),
  };
  return { callers, served };
}

const usage = (tables: Record<string, Row[]>, kind: string = FACTORY_USAGE_KIND) => (tables.assortment_ai_usage ?? []).filter((r) => r.kind === kind);
const usageRow = (calls: number, kind: string = FACTORY_USAGE_KIND): Row => ({ day: TODAY, kind, calls, failed_calls: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0, updated_at: "2026-10-07T08:00:00Z" });
const deps = (callers: FactoryCallers, over: Record<string, unknown> = {}) => ({ env: ENV, callers, clock: () => NOW, ...over });
const SEARCH = { queryZh: "女包 工厂", queryRu: "женские сумки фабрика", cluster: "shiling" as const, who: WHO };

// ---------------------------------------------------------------------------
// Поиск

test("без ключа 1688 поиск не делает ни одного запроса и в базу не ходит: причина одной строкой", async () => {
  const { db, log } = fakeDb();
  const f = fakeCallers();
  const r = await runFactorySearch(db, SEARCH, { ...deps(f.callers), env: {} });
  assert.equal(r.ok, false);
  assert.equal(r.refused, "no_key");
  assert.match(String(r.reason), /ключ 1688 не задан/);
  assert.equal(f.served.length, 0);
  assert.equal(log.length, 0);
});

test("запрос для 1688 — на китайском: русский текст и пустота — отказ без запросов; чип кластера дописывается видимо, без повтора слов", async () => {
  const { db } = fakeDb();
  const f = fakeCallers();
  const r = await runFactorySearch(db, { ...SEARCH, queryZh: "женские сумки" }, deps(f.callers));
  assert.equal(r.refused, "bad_query");
  assert.equal(f.served.length, 0);
  assert.equal(normalizeQueryZh("  女包\u0007  工厂 "), "女包 工厂");
  assert.equal(normalizeQueryZh("x".repeat(61)), null);
  assert.equal(composeQuery("女包 工厂", "shiling"), "女包 工厂 狮岭");
  assert.equal(composeQuery("狮岭 女包", "shiling"), "狮岭 女包", "слово уже есть — не дублируется");
  assert.equal(composeQuery("女包", "guangzhou"), "女包 广州 桂花岗");
  assert.equal(composeQuery("女包", null), "女包");
  assert.equal(factoryQueryKey("女包  工厂"), factoryQueryKey("女包 工厂"));
});

test("поиск: два запроса к 1688 разом по одному тексту (с кластером), учёт — 2 запроса за 0 $, выдача сведена, кэш записан без людей", async () => {
  const { db, tables } = fakeDb();
  const f = fakeCallers();
  const r = await runFactorySearch(db, SEARCH, deps(f.callers));
  assert.equal(r.ok, true);
  assert.deepEqual(f.served.map((s) => [s.skill, s.arg]), [["suppliers", "女包 工厂 狮岭"], ["products", "女包 工厂 狮岭"]]);
  assert.equal(r.calls, FACTORY_CALLS_PER_SEARCH);
  assert.equal(r.callsToday, 2);
  assert.equal(r.queryZh, "女包 工厂 狮岭");
  assert.deepEqual(usage(tables).map((u) => [u.calls, u.failed_calls, u.cost_usd]), [[2, 0, 0]]);
  assert.deepEqual(usage(tables, ENGINE_KIND.cn1688), [], "не в статью снимка трендов: поиск не выбирает его недельный потолок");
  assert.deepEqual([r.sources.suppliers.status, r.sources.suppliers.count, r.sources.products.status, r.sources.products.count], ["ok", 5, "ok", 12]);
  assert.equal(r.factories.length, 5);
  assert.equal(r.sellers.length, 3);
  assert.ok(r.notes.includes(FACTORY_UNVERIFIED_NOTE), "«вживую не проверено» — в ответе");
  assert.equal(tables.assortment_cn_factory_search.length, 1);
  const row = tables.assortment_cn_factory_search[0];
  assert.equal(r.searchId, row.id);
  assert.equal(row.query_zh, "女包 工厂 狮岭");
  assert.equal(row.cluster_key, "shiling");
  assert.equal(row.calls, 2);
  assert.equal(row.expires_at, new Date(NOW + 7 * DAY).toISOString());
  const cached = JSON.stringify(row.result);
  for (const p of PEOPLE) assert.ok(!cached.includes(p), `в кэше нет «${p}»`);
  assert.ok(cached.includes("广州市花都区狮岭镇明辉皮具有限公司") && cached.includes("¥25,5–31"), "юрлицо и цены — есть");
});

test("повтор того же запроса за 7 дней — из кэша: ни одного запроса к 1688, тот же searchId; через 7 дней — заново, старое стирается", async () => {
  const { db, tables } = fakeDb();
  const f = fakeCallers();
  const first = await runFactorySearch(db, SEARCH, deps(f.callers));
  const again = await runFactorySearch(db, { ...SEARCH, queryZh: " 女包  工厂 " }, deps(f.callers, { clock: () => NOW + 6 * DAY }));
  assert.equal(f.served.length, 2, "второй раз 1688 не спрашивали");
  assert.equal(again.fromCache, true);
  assert.equal(again.calls, 0);
  assert.equal(again.searchId, first.searchId);
  assert.deepEqual(again.factories.map((c) => c.displayName), first.factories.map((c) => c.displayName));
  assert.equal(usage(tables)[0].calls, 2, "из кэша — не запрос");
  const later = await runFactorySearch(db, SEARCH, deps(f.callers, { clock: () => NOW + 8 * DAY }));
  assert.equal(later.fromCache, false);
  assert.equal(f.served.length, 4);
  assert.deepEqual(tables.assortment_cn_factory_search.map((r) => r.id), [later.searchId], "просроченная выдача стёрта");
});

test("без миграции: поиск идёт без кэша (searchId нет — шорт-лист недоступен), причина словами; учёт пишется", async () => {
  const { db, tables } = fakeDb({ missing: ["assortment_cn_factory_search", "assortment_cn_factory"] });
  const f = fakeCallers();
  const r = await runFactorySearch(db, SEARCH, deps(f.callers));
  assert.equal(r.ok, true);
  assert.equal(r.cacheAvailable, false);
  assert.equal(r.searchId, null);
  assert.ok(r.notes.some((n) => n.includes("202610070010")));
  assert.equal(f.served.length, 2);
  assert.equal(usage(tables)[0].calls, 2);
});

test("без учёта запросов (assortment_ai_usage) поиск не запускается — лимит нечем считать", async () => {
  const { db } = fakeDb({ missing: ["assortment_ai_usage"] });
  const f = fakeCallers();
  const r = await runFactorySearch(db, SEARCH, deps(f.callers));
  assert.equal(r.refused, "no_usage");
  assert.equal(r.reason, NO_USAGE_WORDS);
  assert.equal(f.served.length, 0);
});

test("дневной потолок: два запроса поиска должны поместиться целиком (58 + 2 = 60 — да, 59 — нет); потолок — на сегодня по Москве", async () => {
  for (const [used, allowed] of [[58, true], [59, false], [60, false]] as const) {
    const { db } = fakeDb({ tables: { assortment_ai_usage: [usageRow(used), { ...usageRow(99), day: "2026-10-06" }, usageRow(50, ENGINE_KIND.cn1688)] } });
    const f = fakeCallers();
    const r = await runFactorySearch(db, SEARCH, deps(f.callers));
    assert.equal(r.ok, allowed, `${used}`);
    assert.equal(f.served.length, allowed ? 2 : 0, `${used}`);
    if (!allowed) assert.match(String(r.reason), new RegExp(`${used} из ${FACTORY_DAILY_CALLS}`));
  }
  assert.equal(FACTORY_DAILY_CALLS, 60);
  assert.equal(factoryCapRefusal(0, 2, 1), "дневной потолок запросов 1688 к фабрикам выбран: 0 из 1 — повторите завтра");
  assert.equal(factoryCapRefusal(null, 2), NO_USAGE_WORDS);
});

test("поиск поставщиков недоступен ключу — продавцы из выдачи товаров всё равно показаны, причина словами; такой ответ кэшируется", async () => {
  const { db, tables } = fakeDb();
  const f = fakeCallers({ suppliers: new China1688Error("1688: параметры запроса не приняты (APIUnsupported)", "param", "APIUnsupported") });
  const r = await runFactorySearch(db, SEARCH, deps(f.callers));
  assert.equal(r.ok, true);
  assert.deepEqual(r.sources.suppliers, { status: "unavailable", reason: "этот навык 1688 нашим ключом недоступен", count: null });
  assert.equal(r.factories.length, 0);
  assert.equal(r.sellers.length, 6, "все продавцы — блоком «Продавцы из выдачи товаров»");
  assert.deepEqual(usage(tables).map((u) => [u.calls, u.failed_calls]), [[2, 1]], "неудачный запрос — тоже запрос");
  assert.equal(tables.assortment_cn_factory_search.length, 1);
});

test("лимит 1688 (429 / Qos) — не повторяем и не кэшируем; оба источника не ответили — поиск не состоялся, в кэше пусто", async () => {
  const { db, tables } = fakeDb();
  const limited = fakeCallers({ suppliers: new China1688Error("лимит", "rate_limit", "QosApiFrequencyLimit") });
  const r = await runFactorySearch(db, SEARCH, deps(limited.callers));
  assert.equal(r.ok, true);
  assert.equal(r.sources.suppliers.status, "rate_limit");
  assert.match(String(r.sources.suppliers.reason), /подождать/);
  assert.ok(r.searchId, "в шорт-лист из неполной выдачи добавить можно");
  assert.ok(r.notes.some((n) => n.includes("выдача неполная")));
  assert.equal(tables.assortment_cn_factory_search.length, 1);
  assert.notEqual(tables.assortment_cn_factory_search[0].query_key, factoryQueryKey("女包 工厂 狮岭"), "неполная выдача — не под ключом запроса");
  const retry = await runFactorySearch(db, SEARCH, deps(limited.callers));
  assert.equal(retry.fromCache, false, "лимит — не кэшируем: повтор спросит 1688 снова");
  assert.equal(limited.served.length, 4);
  assert.equal(cacheable({ suppliers: { status: "unavailable", reason: null, count: null }, products: { status: "ok", reason: null, count: 1 } }), true);
  assert.equal(cacheable({ suppliers: { status: "error", reason: null, count: null }, products: { status: "ok", reason: null, count: 1 } }), false);

  const both = fakeCallers({ suppliers: new China1688Error("k", "auth"), products: new China1688Error("k", "auth") });
  const { db: db2, tables: t2 } = fakeDb();
  const failed = await runFactorySearch(db2, SEARCH, deps(both.callers));
  assert.equal(failed.ok, false);
  assert.equal(failed.refused, "failed");
  assert.equal(failed.reason, "этот навык 1688 нашим ключом недоступен");
  assert.equal(t2.assortment_cn_factory_search.length, 0);
  assert.deepEqual(usage(t2).map((u) => [u.calls, u.failed_calls]), [[2, 2]]);
  assert.deepEqual([failed.factories, failed.sellers], [[], []], "не «0 фабрик», а отказ с причиной");
});

// ---------------------------------------------------------------------------
// Перевод запроса

function fakeTranslator(answer: string | null = "女包 托特包 灯芯绒", price = { in: 0.1, out: 0.4 }) {
  const asked: string[][] = [];
  const setup: TranslateSetup = {
    model: "google/gemini-2.5-flash-lite", price, reason: null,
    translate: async (texts) => {
      asked.push(texts);
      return { texts: [answer], inputTokens: 120, outputTokens: 12, costUsd: 0.00002 };
    },
  };
  return { setup, asked };
}

test("перевод запроса: Polza по вопросу «с русского на китайский», расход — статья cn_translate; ответ без иероглифов — «напишите по-китайски»", async () => {
  const { db, tables } = fakeDb();
  const t = fakeTranslator();
  const r = await translateFactoryQuery(db, "тоут, вельвет", { translator: t.setup, env: ENV, clock: () => NOW });
  assert.deepEqual(r, { queryZh: "女包 托特包 灯芯绒", reason: null, costUsd: 0.00002 });
  assert.deepEqual(t.asked, [["тоут, вельвет"]]);
  assert.deepEqual(usage(tables, ENGINE_KIND.cnTranslate).map((u) => [u.calls, u.cost_usd]), [[1, 0.00002]]);
  assert.match(FACTORY_QUERY_PROMPT, /с русского на китайский/);
  const bad = await translateFactoryQuery(db, "тоут", { translator: fakeTranslator("tote bag").setup, env: ENV, clock: () => NOW });
  assert.equal(bad.queryZh, null);
  assert.match(String(bad.reason), /напишите запрос по-китайски/);
});

test("перевод уходит в Polza с вопросом «с русского на китайский» (а не вопросом трендов) и тем же форматом ответа; ключ Polza — только в заголовке", async () => {
  const sent: Array<{ url: string; body: { messages: Array<{ role: string; content: string }>; max_tokens: number } ; auth: string }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init.body)), auth: String((init.headers as Record<string, string>).Authorization) });
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "[\"托特包 灯芯绒\"]" } }], usage: { prompt_tokens: 90, completion_tokens: 8 } }) } as Response;
  }) as unknown as typeof fetch;
  const setup = factoryTranslatorFromEnv({ ...ENV, POLZA_API_KEY: "polza-test-key" }, fetchImpl);
  assert.equal(setup.reason, null);
  const { db } = fakeDb();
  const r = await translateFactoryQuery(db, "тоут, вельвет", { translator: setup, env: ENV, clock: () => NOW });
  assert.equal(r.queryZh, "托特包 灯芯绒");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, "https://polza.ai/api/v1/chat/completions");
  assert.deepEqual(sent[0].body.messages, [{ role: "system", content: FACTORY_QUERY_PROMPT }, { role: "user", content: JSON.stringify(["тоут, вельвет"]) }]);
  assert.equal(sent[0].auth, "Bearer polza-test-key");
  assert.ok(!JSON.stringify(sent[0].body).includes("polza-test-key"));
});

test("перевод: без Polza — человек пишет по-китайски сам; потолок движка выбран — платный вызов не делается; без учёта расхода — тоже", async () => {
  const { db } = fakeDb();
  const none = await translateFactoryQuery(db, "тоут", { env: { ...ENV }, clock: () => NOW });
  assert.equal(none.queryZh, null);
  assert.match(String(none.reason), /нет ключа Polza.*напишите запрос по-китайски/);
  const spent = fakeDb({ tables: { assortment_ai_usage: [{ ...usageRow(1, ENGINE_KIND.catalogAi), cost_usd: 30 }] } });
  const t = fakeTranslator();
  const capped = await translateFactoryQuery(spent.db, "тоут", { translator: t.setup, env: ENV, clock: () => NOW });
  assert.equal(capped.queryZh, null);
  assert.match(String(capped.reason), /общий потолок движка/);
  assert.equal(t.asked.length, 0, "за потолком — не платим");
  const noUsage = await translateFactoryQuery(fakeDb({ missing: ["assortment_ai_usage"] }).db, "тоут", { translator: t.setup, env: ENV, clock: () => NOW });
  assert.match(String(noUsage.reason), /нет учёта расхода/);
  assert.equal(t.asked.length, 0);
});

// ---------------------------------------------------------------------------
// Проверка компании (88查)

test("88查, поиск: только юрлица (у ИП название не храним и в реестре не ищем) — один запрос, кандидаты без людей, точное совпадение отмечено", async () => {
  const { db, tables } = fakeDb();
  const f = fakeCallers();
  const ip = await runCompanySearch(db, { name: "广州市白云区李明皮具商行", who: WHO }, deps(f.callers));
  assert.equal(ip.refused, "not_company");
  assert.equal(f.served.length, 0);
  const r = await runCompanySearch(db, { name: "广州市花都区狮岭镇明辉皮具有限公司", who: WHO }, deps(f.callers));
  assert.equal(r.ok, true);
  assert.equal(r.calls, 1);
  assert.deepEqual(f.served.map((s) => s.skill), ["companySearch"]);
  assert.equal(r.exactIndex, 0);
  assert.equal(r.candidates.length, 3);
  const out = JSON.stringify(r);
  for (const p of PEOPLE) assert.ok(!out.includes(p), `нет «${p}»`);
  assert.equal(usage(tables)[0].calls, 1);
  const noKey = await runCompanySearch(db, { name: "某某有限公司", who: WHO }, { ...deps(f.callers), env: {} });
  assert.equal(noKey.refused, "no_key");
  const capped = await runCompanySearch(fakeDb({ tables: { assortment_ai_usage: [usageRow(60)] } }).db, { name: "某某有限公司", who: WHO }, deps(f.callers));
  assert.equal(capped.refused, "daily_cap");
  assert.equal(f.served.length, 1);
});

test("88查, риски: код из 18 знаков; ИП — отказ без запроса; факты с флагами; с записью шорт-листа — сохраняются без имён и текстов дел", async () => {
  const { db, tables } = fakeDb();
  const f = fakeCallers();
  const bad = await runCompanyRisk(db, { creditCode: "123", who: WHO }, deps(f.callers));
  assert.equal(bad.refused, "bad_input");
  const ip = await runCompanyRisk(db, { creditCode: "92440114MA5ZZZZZ9Q", candidate: { entType: "个体工商户", status: "存续" }, who: WHO }, deps(f.callers));
  assert.equal(ip.refused, "not_company");
  assert.equal(f.served.length, 0);

  const search = await runFactorySearch(db, SEARCH, deps(f.callers));
  const added = await addToShortlist(db, { searchId: search.searchId as string, key: search.factories[0].key as string, who: WHO, nowMs: NOW });
  const candidate = { status: "存续（在营、开业、在册）", establishedOn: "2016-05-20", entType: "有限责任公司(自然人投资或控股)", regCapText: "500万 (人民币)", area: "广东省广州市花都区", name: "张测试" };
  const r = await runCompanyRisk(db, { creditCode: "91440114MA59ABCD1X", candidate, factoryId: added.item.id, who: WHO }, deps(f.callers, { clock: () => NOW + 1000 }));
  assert.equal(r.ok, true);
  assert.equal(r.calls, 1);
  assert.deepEqual(r.facts?.flags.map((x) => x.key), ["registry_dishonest", "registry_abnormal"]);
  assert.equal(r.savedTo, added.item.id);
  const row = tables.assortment_cn_factory[0];
  assert.equal(row.credit_code, "91440114MA59ABCD1X", "у юрлица код сохраняется");
  const stored = JSON.stringify(row.registry);
  for (const p of PEOPLE) assert.ok(!stored.includes(p), `в записи нет «${p}»`);
  assert.ok(!/indicators|contentChinese/.test(stored));
  assert.equal((row.registry as { checkedBy: string }).checkedBy, WHO);
  assert.equal(candidateRelay({ entType: "个体工商户" })?.entity, "individual", "вид лица — по типу реестра, не со слов экрана");
  assert.equal(candidateRelay({ status: "注销", entity: "company" })?.active, false);
  assert.equal(usage(tables)[0].calls, 3, "поиск (2) + риски (1)");
});

test("реестр сказал «ИП» — запись шорт-листа становится ИП: название и код стираются, остаётся псевдоним", async () => {
  const { db, tables } = fakeDb();
  const f = fakeCallers();
  const search = await runFactorySearch(db, SEARCH, deps(f.callers));
  const added = await addToShortlist(db, { searchId: search.searchId as string, key: search.factories[0].key as string, who: WHO, nowMs: NOW });
  assert.equal(added.item.name, "广州市花都区狮岭镇明辉皮具有限公司");
  const facts = { checkedOn: TODAY, entity: "company" as const, status: "存续", active: true, establishedOn: null, ageYears: null, entType: "有限责任公司", regCapText: null, area: null, risks: null, indicators: [], flags: [] };
  assert.deepEqual(await saveRegistryCheck(db, { id: added.item.id, creditCode: "91440114MA59ABCD1X", who: WHO, nowMs: NOW, facts }), { saved: true, reason: null });
  assert.equal(tables.assortment_cn_factory[0].credit_code, "91440114MA59ABCD1X");
  const saved = await saveRegistryCheck(db, {
    id: added.item.id, creditCode: "91440114MA59ABCD1X", who: WHO, nowMs: NOW + 1,
    facts: { checkedOn: TODAY, entity: "individual", status: "存续", active: true, establishedOn: null, ageYears: null, entType: "个体工商户", regCapText: null, area: null, risks: null, indicators: [], flags: [] },
  });
  assert.deepEqual(saved, { saved: true, reason: null });
  const row = tables.assortment_cn_factory[0];
  assert.deepEqual([row.entity, row.company_name, row.credit_code, row.pseudonym], ["individual", null, null, "Фабрика 1"]);
  const missingRow = await saveRegistryCheck(db, {
    id: "00000000-0000-4000-8000-000000000000", creditCode: null, who: WHO,
    facts: { checkedOn: TODAY, entity: "company", status: null, active: null, establishedOn: null, ageYears: null, entType: null, regCapText: null, area: null, risks: null, indicators: [], flags: [] },
  });
  assert.equal(missingRow.saved, false);
});

// ---------------------------------------------------------------------------
// Шорт-лист

async function withSearch() {
  const env = fakeDb();
  const f = fakeCallers();
  const search = await runFactorySearch(env.db, SEARCH, deps(f.callers));
  const card = (name: string) => [...search.factories, ...search.sellers].find((c) => c.displayName === name) as FactoryCard;
  return { ...env, search, card };
}

test("«В шорт-лист»: снимок — с сервера по searchId; юрлицо — с названием, ИП и неясные — «Фабрика N» по порядку шорт-листа; фото в снимке нет", async () => {
  const { db, tables, search, card } = await withSearch();
  const a = await addToShortlist(db, { searchId: search.searchId as string, key: card("广州市花都区狮岭镇明辉皮具有限公司").key as string, who: WHO, nowMs: NOW });
  const b = await addToShortlist(db, { searchId: search.searchId as string, key: card("Фабрика 6").key as string, who: WHO, nowMs: NOW });
  const c = await addToShortlist(db, { searchId: search.searchId as string, key: card("Фабрика 4").key as string, who: WHO, nowMs: NOW });
  assert.deepEqual([a.created, b.created, c.created], [true, true, true]);
  assert.deepEqual([a.item.displayName, b.item.displayName, c.item.displayName], ["广州市花都区狮岭镇明辉皮具有限公司", "Фабрика 1", "Фабрика 2"]);
  assert.equal(b.item.name, null);
  assert.equal(c.item.shopUrl, "https://shop-test5.1688.com/", "у ИП — ссылка на магазин");
  assert.equal(a.item.status, "candidate");
  assert.deepEqual(a.item.history, [{ status: "candidate", reason: null, by: WHO, at: new Date(NOW).toISOString() }]);
  assert.equal(a.item.snapshotOn, TODAY);
  assert.equal(a.item.snapshot.prices?.min, 25.5, "цены на дату добавления — в снимке");
  const stored = JSON.stringify(tables.assortment_cn_factory);
  for (const p of PEOPLE) assert.ok(!stored.includes(p), `в шорт-листе нет «${p}»`);
  assert.ok(!stored.includes("alicdn"), "адрес фото (в нём id загрузившего) не хранится");
  const again = await addToShortlist(db, { searchId: search.searchId as string, key: card("广州市花都区狮岭镇明辉皮具有限公司").key as string, who: "director@example.test", nowMs: NOW + 1 });
  assert.equal(again.created, false);
  assert.equal(again.item.id, a.item.id);
  assert.equal(tables.assortment_cn_factory.length, 3);
});

test("«В шорт-лист» — только из свежего поиска и только существующая карточка; без миграции — понятная ошибка", async () => {
  const { db, search, card } = await withSearch();
  await assert.rejects(addToShortlist(db, { searchId: search.searchId as string, key: "url:https://x.1688.com/", who: WHO, nowMs: NOW }), /этой фабрики нет в результате поиска/);
  await assert.rejects(addToShortlist(db, { searchId: search.searchId as string, key: card("Фабрика 7").key as string, who: WHO, nowMs: NOW + 8 * DAY }), /старше 7 дней/);
  await assert.rejects(addToShortlist(db, { searchId: "00000000-0000-4000-8000-000000000000", key: "url:x", who: WHO, nowMs: NOW }), /не найден/);
  const bare = fakeDb({ missing: ["assortment_cn_factory_search", "assortment_cn_factory"] });
  await assert.rejects(addToShortlist(bare.db, { searchId: "00000000-0000-4000-8000-000000000000", key: "url:x", who: WHO }), (e: unknown) => (e as Error).message === FACTORY_MIGRATION_WORDS);
  const list = await loadShortlist(bare.db);
  assert.deepEqual(list, { available: false, reason: FACTORY_MIGRATION_WORDS, items: [] }, "без миграции шорт-лист скрыт с причиной");
});

test("статус ставит человек: смена — в историю «кто и когда»; отклонить — только с причиной; уход из «отклонена» снимает причину", async () => {
  const { db, search, card } = await withSearch();
  const { item } = await addToShortlist(db, { searchId: search.searchId as string, key: card("东莞市鑫源皮具有限公司").key as string, who: WHO, nowMs: NOW });
  const contacted = await patchShortlist(db, { id: item.id, patch: { status: "contacted" }, who: "director@example.test", nowMs: NOW + 1000 });
  assert.equal(contacted.status, "contacted");
  assert.deepEqual(contacted.history.map((h) => [h.status, h.by]), [["candidate", WHO], ["contacted", "director@example.test"]]);
  await assert.rejects(patchShortlist(db, { id: item.id, patch: { status: "rejected" }, who: WHO, nowMs: NOW + 2000 }), /только с причиной/);
  await assert.rejects(patchShortlist(db, { id: item.id, patch: { status: "approved_by_ai" }, who: WHO }), /статус:/);
  const rejected = await patchShortlist(db, { id: item.id, patch: { status: "rejected", reason: "образец: гидролиз PU" }, who: WHO, nowMs: NOW + 3000 });
  assert.deepEqual([rejected.status, rejected.rejectReason, rejected.history.length], ["rejected", "образец: гидролиз PU", 3]);
  const back = await patchShortlist(db, { id: item.id, patch: { status: "sample_ordered" }, who: WHO, nowMs: NOW + 4000 });
  assert.deepEqual([back.status, back.rejectReason, back.history.length], ["sample_ordered", null, 4]);
  const same = await patchShortlist(db, { id: item.id, patch: { status: "sample_ordered" }, who: WHO, nowMs: NOW + 5000 });
  assert.equal(same.history.length, 4, "тот же статус — не новая строка истории");
});

test("чек-лист: пункты раздельно, без суммы (да / нет / не ясно, оценка образца, число застрахованных); null снимает отметку; чужие пункты и значения — отказ", async () => {
  const { db, search, card } = await withSearch();
  const { item } = await addToShortlist(db, { searchId: search.searchId as string, key: card("东莞市鑫源皮具有限公司").key as string, who: WHO, nowMs: NOW });
  const marked = await patchShortlist(db, { id: item.id, patch: { checklist: { license_production: "yes", insured_staff: 64, sample_material: "good", sample_edges: "bad" } }, who: WHO, nowMs: NOW + 1 });
  assert.deepEqual(Object.fromEntries(Object.entries(marked.checklist).map(([k, v]) => [k, v?.value])), { license_production: "yes", insured_staff: 64, sample_material: "good", sample_edges: "bad" });
  assert.equal(marked.checklist.sample_edges?.by, WHO);
  const cleared = await patchShortlist(db, { id: item.id, patch: { checklist: { sample_edges: null } }, who: WHO, nowMs: NOW + 2 });
  assert.equal(cleared.checklist.sample_edges, undefined);
  assert.ok(!JSON.stringify(cleared).match(/"(total|sum|score)"/), "суммы нет");
  await assert.rejects(patchShortlist(db, { id: item.id, patch: { checklist: { overall: "good" } }, who: WHO }), /нет такого пункта/);
  assert.throws(() => checklistValue("sample_lining", "5"), /good \/ acceptable \/ bad \/ unknown/);
  assert.throws(() => checklistValue("insured_staff", -1), /целое число/);
  assert.equal(checklistValue("insured_staff", "12"), 12);
  assert.deepEqual(FACTORY_CHECKLIST.filter((i) => i.key.startsWith("sample_")).map((i) => i.key), ["sample_material", "sample_hardware", "sample_stitching", "sample_edges", "sample_lining"]);
});

test("заметка и причина — без телефонов, WeChat и почты; конфликт правок (запись уже изменили) — отказ, а не тихая перезапись", async () => {
  const { db, tables, hooks, search, card } = await withSearch();
  const { item } = await addToShortlist(db, { searchId: search.searchId as string, key: card("东莞市鑫源皮具有限公司").key as string, who: WHO, nowMs: NOW });
  for (const bad of ["менеджер: +86 138 0000 0000", "微信 abc123", "wx: shoes88", "почта sales@factory.cn"]) {
    await assert.rejects(patchShortlist(db, { id: item.id, patch: { note: bad }, who: WHO }), /контакты людей не храним/, bad);
  }
  await assert.rejects(patchShortlist(db, { id: item.id, patch: { status: "rejected", reason: "WeChat only" }, who: WHO }), /контакты/);
  assert.equal(contactProblem("партия 300 шт, образец 3 дня, 2026-10-07"), null, "числа и даты — не телефон");
  const noted = await patchShortlist(db, { id: item.id, patch: { note: "просили видео раскроя", updatedAt: item.updatedAt }, who: WHO, nowMs: NOW + 10 });
  assert.equal(noted.note, "просили видео раскроя");
  await assert.rejects(patchShortlist(db, { id: item.id, patch: { note: "старая вкладка", updatedAt: item.updatedAt }, who: WHO, nowMs: NOW + 20 }), /уже изменили/);
  hooks.afterSelect = (table, all) => {
    if (table === "assortment_cn_factory") all.assortment_cn_factory[0].updated_at = "2026-10-07T23:59:59.000Z";
  };
  await assert.rejects(patchShortlist(db, { id: item.id, patch: { note: "x" }, who: WHO }), /уже изменили/, "между чтением и записью запись изменили — конфликт");
  hooks.afterSelect = undefined;
  assert.equal(tables.assortment_cn_factory[0].note, "просили видео раскроя", "чужая правка не затёрта");
  await assert.rejects(patchShortlist(db, { id: "00000000-0000-4000-8000-000000000000", patch: { note: "x" }, who: WHO }), /нет в шорт-листе/);
});

test("шорт-лист читается целиком листанием (больше 1 000 записей), по времени добавления", async () => {
  const rows: Row[] = Array.from({ length: 1005 }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, direction: "bags", factory_key: `offer:${1000000 + i}`, entity: "unknown", company_name: null, pseudonym: `Фабрика ${i + 1}`,
    shop_url: null, credit_code: null, province: null, city: null, cluster_key: null, offer_ids: [], query_zh: "女包", snapshot: {}, snapshot_on: TODAY, status: "candidate",
    reject_reason: null, status_history: [], checklist: {}, note: null, registry: null, created_by: WHO, created_at: new Date(NOW + i * 1000).toISOString(), updated_by: WHO,
    updated_at: new Date(NOW + i * 1000).toISOString(),
  }));
  const { db } = fakeDb({ tables: { assortment_cn_factory: rows } });
  const list = await loadShortlist(db);
  assert.equal(list.items.length, 1005);
  assert.equal(list.items[1004].displayName, "Фабрика 1005");
});

// ---------------------------------------------------------------------------
// Права и вкладка

test("права: искать, проверять и править — закупщик и директор; wb_manager — только смотрит; вторая роль добавляет доступ", () => {
  assert.deepEqual(FACTORY_EDIT_ROLES, ["director", "buyer"]);
  assert.equal(canEditFactories(["director"]), true);
  assert.equal(canEditFactories(["buyer"]), true);
  assert.equal(canEditFactories(["wb_manager"]), false);
  assert.equal(canEditFactories(["wb_manager", "buyer"]), true);
  assert.equal(canEditFactories([]), false);
});

test("вкладка «Фабрики (1688)»: только в «Сумках» и только с ключом 1688 (в «Куртках» — нет)", () => {
  assert.deepEqual(factoriesTab("bags", ENV), { visible: true, reason: null });
  assert.equal(factoriesTab("jackets", ENV).visible, false);
  assert.match(String(factoriesTab("jackets", ENV).reason), /только в разделе «Сумки»/);
  assert.equal(factoriesTab("bags", {}).visible, false);
  assert.equal(factoriesTab(null, ENV).visible, false);
});

const ROUTES = "app/api/assortment-development/factories";

test("роуты: каждый под requireApiSession(ASSORTMENT_ROLES); запись и запросы к 1688 — только закупщик и директор (проверка до базы); GET шорт-листа — всем ролям модуля", () => {
  const search = read(`${ROUTES}/search/route.ts`);
  const check = read(`${ROUTES}/check-company/route.ts`);
  const shortlist = read(`${ROUTES}/shortlist/route.ts`);
  for (const [name, src] of [["search", search], ["check-company", check], ["shortlist", shortlist]] as const) {
    assert.match(src, /requireApiSession\(ASSORTMENT_ROLES\)/, name);
    assert.ok(!/console\.log/.test(src), name);
  }
  for (const [name, src, handlers] of [["search", search, ["POST"]], ["check-company", check, ["POST"]], ["shortlist", shortlist, ["POST", "PATCH"]]] as const) {
    for (const h of handlers) {
      const body = src.slice(src.indexOf(`export async function ${h}(`));
      const guard = body.indexOf("canEditFactories(sessionRoles(session))");
      assert.ok(guard > 0 && guard < body.indexOf("getSupabaseAdmin()"), `${name} ${h}: права — до базы и до 1688`);
    }
  }
  const get = shortlist.slice(shortlist.indexOf("export async function GET("), shortlist.indexOf("export async function POST("));
  assert.ok(!/if \(!canEditFactories/.test(get), "смотреть шорт-лист может и wb_manager");
  assert.match(search, /export const maxDuration = 90;/, "поиск поставщиков отвечает до минуты");
  assert.match(search, /mode === "translate"/);
  assert.deepEqual(readdirSync(join(root, ROUTES)).sort(), ["check-company", "search", "shortlist"]);
});

test("пишущие навыки 1688 не вызываются и не встроены; официальные cli.py не запускаются; ключ — только из окружения", () => {
  const files = ["lib/assortment/factories1688.ts", "lib/assortment/factorySearch.ts", "lib/assortment/factoryShortlist.ts", "lib/assortment/factoryCards.ts", "lib/assortment/factoryGuide.ts",
    `${ROUTES}/search/route.ts`, `${ROUTES}/check-company/route.ts`, `${ROUTES}/shortlist/route.ts`];
  for (const file of files) {
    const src = read(file);
    assert.doesNotMatch(src, /sourcing[-_]inquiry|procurement|utp[-_]shopping|88syt|distributingoffer|distribute_offer|fx_send_ww|message[-_]push|reportSkillsUsage|cli\.py|child_process|ALI_1688_AK\s*=|\.1688-ak/, file);
  }
  assert.match(read("lib/assortment/factories1688.ts"), /SOURCE_SUPPLIERS_PATH = "\/api\/1688_source_suppliers\/1\.0\.0"/);
});

test("учёт: статья запросов раздела — отдельная (cn_1688_factory), 0 $, входит в учёт движка с подписью", () => {
  assert.equal(FACTORY_USAGE_KIND, "cn_1688_factory");
  assert.equal(ENGINE_KIND.cn1688Factory, FACTORY_USAGE_KIND);
  assert.equal(isEngineKind(FACTORY_USAGE_KIND), true);
  assert.equal(ENGINE_KIND_LABEL[FACTORY_USAGE_KIND], "запросы 1688: фабрики сумок");
});
