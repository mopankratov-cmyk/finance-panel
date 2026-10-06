import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";
import test, { mock } from "node:test";
import { containsMoney } from "../lib/assortment/attributes.ts";
import { parseProfileInput } from "../lib/assortment/brandProfiles.ts";
import { briefCsv, csvCell, exportFileName, isCollectionKind, isReplaceReason, type BriefSnapshot } from "../lib/assortment/collections.ts";
import { collectionFailure } from "../lib/assortment/collectionsApi.ts";
import { createCollection } from "../lib/assortment/collectionsStore.ts";
import { DecisionInputError, decisionReason, isActionId, isReferenceStatus, reasonLabel } from "../lib/assortment/decisions.ts";
import { baseDomain, extractHtmlProduct, importDedupKey, legacyImportDedupKey, sameSite, trustedCanonical } from "../lib/assortment/extract.ts";
import { ImportInputError, importReference } from "../lib/assortment/importer.ts";
import { reasonKey } from "../lib/assortment/learning.ts";
import { hasOwnKey } from "../lib/assortment/own.ts";

/** Граница ТЗ «в модуле нет цен», формулы в CSV, ключи прототипа, доверие к чужим полям страницы (аудит 05.10). */

test("Заметка и название при импорте: цены и деньги не принимаются (как при правке признаков), база не трогается", async () => {
  const untouched = new Proxy({}, { get: () => { throw new Error("база не должна читаться"); } }) as never;
  for (const note of ["цена 120 €", "Стоимость около 5000 ₽", "дорого, 99 USD", "себестоимость низкая", "$50"]) {
    await assert.rejects(() => importReference(untouched, { direction: "bags", url: "https://x.example/p", note }, null), (e: unknown) => e instanceof ImportInputError && /Цены и деньги/.test(e.message), note);
  }
  await assert.rejects(() => importReference(untouched, { direction: "bags", url: "https://x.example/p", title: "Сумка за 99 usd" }, null), ImportInputError);
});

test("Комментарий решения: цены и деньги не принимаются; обычный текст проходит", () => {
  assert.throws(() => decisionReason("rejected", "other", "слишком дорого, 5000 руб"), DecisionInputError);
  assert.throws(() => decisionReason("rejected", "shape", "цена выше рынка"), DecisionInputError);
  assert.throws(() => decisionReason("selected", null, "берём, € 20"), DecisionInputError);
  assert.equal(decisionReason("rejected", "shape", "слишком мягкая"), "shape:слишком мягкая");
  assert.equal(decisionReason("selected", null, "в план на весну"), "в план на весну");
});

test("Профиль бренда: цены и деньги не принимаются ни в одном текстовом поле", () => {
  for (const field of ["audience", "notes", "palette", "sourceRef"] as const) {
    const bad = parseProfileInput("jackets", { version: 1, [field]: "ориентир по цене 5000 ₽" });
    assert.ok("error" in bad && /цены и деньги/.test(bad.error), field);
  }
  const ok = parseProfileInput("jackets", { version: 1, audience: "Женщины 30–45", notes: "базовые вещи", palette: "чёрный, беж", sourceRef: "решение владельца 05.10" });
  assert.ok("patch" in ok);
});

test("CSV для Excel: текст, начинающийся с = + - @ табуляцией или CR, не исполнится формулой; обычное не меняется", () => {
  for (const value of ["=HYPERLINK(\"http://evil\")", "+1+1", "-2+3", "@SUM(A1)", "\t=1", "\r=1"]) assert.match(csvCell(value), /^"'/, JSON.stringify(value));
  assert.equal(csvCell("Хобо Mini"), '"Хобо Mini"');
  assert.equal(csvCell('Сумка "Нова"'), '"Сумка ""Нова"""');
  assert.equal(csvCell("A-1"), '"A-1"', "дефис внутри текста не трогаем");
  assert.equal(csvCell("—"), '"—"');
  const snapshot = { items: [{ position: "Модель 1", title: '=HYPERLINK("http://evil","клик")', brand: "@Brand", article: "-1", sourceUrl: "https://x.example", idea: null, details: [], differences: "", questions: "", seasonFit: "", observed: [], missing: [], nextStep: null }] } as unknown as BriefSnapshot;
  const csv = briefCsv(snapshot);
  assert.match(csv, /;"'=HYPERLINK\(""http:\/\/evil"",""клик""\)";"'@Brand";"'-1";/);
});

test("Имя файла выгрузки: ASCII, без кавычек и переводов строк, не длиннее 40 знаков периода; кириллица и пустое не роняют", () => {
  assert.equal(exportFileName("2026-11", 3), "zadanie-2026-11-v3");
  assert.equal(exportFileName(null, 1), "zadanie-podborka-v1");
  for (const period of ["Осень 2026", 'a"b\r\nc', "../../etc", "ёёё", "x".repeat(200)]) {
    const name = exportFileName(period, 2);
    assert.match(name, /^zadanie-[A-Za-z0-9._-]+-v2$/, period);
    assert.ok(name.length <= 60);
  }
});

test("Ключи прототипа не проходят проверки «известная причина / вид / статус / действие»", () => {
  for (const key of ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"]) {
    assert.equal(isActionId(key), false, key);
    assert.equal(isReferenceStatus(key), false, key);
    assert.equal(isReplaceReason(key), false, key);
    assert.equal(isCollectionKind(key), false, key);
    assert.equal(reasonKey(key), null, key);
    assert.equal(reasonKey(`replaced:${key}`), null, key);
    assert.throws(() => decisionReason("rejected", key, null), DecisionInputError, key);
    assert.equal(reasonLabel(key), key, "неизвестная причина показывается как есть, без ярлыка из прототипа");
  }
  assert.equal(isActionId("rejected"), true);
  assert.equal(isCollectionKind("bags_month"), true);
  assert.equal(reasonKey("shape:слишком мягкая"), "shape");
  assert.equal(hasOwnKey({ a: 1 }, "a"), true);
  assert.equal(hasOwnKey({ a: 1 }, "toString"), false);
});

test("Каноническая ссылка страницы: только http(s) и тот же сайт; javascript:, чужой домен и мусор отбрасываются, поддомен витрины — свой", () => {
  const page = "https://eu.brand.com/gb/p/1";
  assert.equal(trustedCanonical("/gb/p/1?x=1", page), "https://eu.brand.com/gb/p/1?x=1");
  assert.equal(trustedCanonical("https://www.brand.com/p/1", page), "https://www.brand.com/p/1", "тот же базовый домен");
  assert.equal(trustedCanonical("javascript:alert(document.cookie)", page), null);
  assert.equal(trustedCanonical("data:text/html,x", page), null);
  assert.equal(trustedCanonical("https://evil.example/phish", page), null);
  assert.equal(trustedCanonical("http://[bad", page), null);
  const html = '<link rel="canonical" href="javascript:alert(1)"><meta property="og:title" content="X">';
  assert.equal(extractHtmlProduct(html, page).canonicalUrl, null);
  assert.equal(extractHtmlProduct('<link rel="canonical" href="/p/1">', page).canonicalUrl, "https://eu.brand.com/p/1");
});

test("Ключ находки при импорте: у сайта вне паспорта артикул включает домен — одинаковый sku у двух сайтов не склеивает находки; у источника из паспорта ключ прежний", () => {
  const a = importDedupKey(null, "", "SKU1", "https://shop-a.com/p/1", "https://shop-a.com/p/1");
  const b = importDedupKey(null, "", "SKU1", "https://shop-b.com/p/9", "https://shop-b.com/p/9");
  assert.notEqual(a, b);
  assert.equal(a, "manual||shop-a.com:SKU1");
  assert.equal(importDedupKey(null, "", "SKU1", "https://eu.shop-a.com/p/2", "https://eu.shop-a.com/p/2"), a, "витрины одного сайта — одна находка");
  assert.equal(importDedupKey("S024", "GB", "123", "https://x.com/p", "https://x.com/p"), "S024|GB|123", "паспортный источник — как раньше");
  assert.equal(importDedupKey(null, "", null, "https://shop-a.com/p/1", "https://shop-a.com/p/1"), "manual||https://shop-a.com/p/1", "артикула нет — адрес");
});

/** Что ловит запрет денег, а что пропускает: таблица для всех мест, где его проверяют (аудит 05.10, замечание «ложные срабатывания»). */
const MONEY_BLOCKED = [
  "цена 500", "Цена: 5000", "цены ниже рынка", "по цене выше", "500 руб", "500 руб.", "5000руб", "500 ₽", "500р", "500 р.", "$100", "€ 20",
  "100 usd", "100 USDT", "99 EUR", "99 euro", "30 юаней", "30 юань", "30 CNY", "cost 5", "COST: 5", "costs", "себестоимость", "Себестоимость низкая",
  "маржа", "маржинальность", "высокая маржинальный", "Margin 20%", "price", "прайс", "прайс-лист", "рубль", "сто рублей", "стоимостью около",
  "price-list", "слишком дорого, 5000 руб", "Цена 500 https://brand.com/p/1",
];
const MONEY_ALLOWED = [
  "2 рубашки-ветровки", "3 рубашка оверсайз", "рубашка", "Мартин Маржела", "Maison Margiela", "Как у Мартин Маржела, но проще",
  "Costume National", "Priceless look", "3 european brands", "2 rubber soles", "4 р-ра", "5 размеров", "оценка качества", "ценный мех",
  "слишком мягкая", "в план на весну", "Женщины 30–45", "чёрный, беж", "решение владельца 05.10",
  "Lacost brand", "Ссылка на каталог https://brand.com/price-list.pdf", "Источник: www.brand.com/prices/cost.html",
];

test("Запрет денег: ловит цену, валюту, себестоимость, маржу целым словом; «2 рубашки», «Маржела», «Costume», «Priceless», адрес с price-list — пропускает", () => {
  for (const text of MONEY_BLOCKED) assert.equal(containsMoney(text), true, `должно блокироваться: ${text}`);
  for (const text of MONEY_ALLOWED) assert.equal(containsMoney(text), false, `должно проходить: ${text}`);
});

test("Запрет денег держится во всех полях: решение, профиль бренда, заметка и название импорта; безобидный текст со словом-соседом проходит везде", async () => {
  const untouched = new Proxy({}, { get: () => { throw new Error("база не должна читаться"); } }) as never;
  const passesImportGate = (patch: { note?: string; title?: string }) =>
    assert.rejects(() => importReference(untouched, { direction: "bags", url: "https://x.example/p", ...patch }, null), (e: unknown) => !(e instanceof ImportInputError) && /база не должна читаться/.test((e as Error).message));
  for (const text of MONEY_BLOCKED) {
    assert.throws(() => decisionReason("rejected", "shape", text), DecisionInputError, `решение: ${text}`);
    const profile = parseProfileInput("jackets", { version: 1, notes: text });
    assert.ok("error" in profile, `профиль: ${text}`);
    await assert.rejects(() => importReference(untouched, { direction: "bags", url: "https://x.example/p", note: text }, null), ImportInputError, `заметка: ${text}`);
    await assert.rejects(() => importReference(untouched, { direction: "bags", url: "https://x.example/p", title: text }, null), ImportInputError, `название: ${text}`);
  }
  for (const text of MONEY_ALLOWED) {
    assert.equal(decisionReason("rejected", "shape", text), `shape:${text}`, `решение: ${text}`);
    assert.ok("patch" in parseProfileInput("jackets", { version: 1, notes: text, sourceRef: text }), `профиль: ${text}`);
    await passesImportGate({ note: text });
    await passesImportGate({ title: text });
  }
});

// ——— Подборки: POST /collections проходит те же проверки, что PATCH ———

type Row = Record<string, unknown>;

/** Таблицы в памяти. Фильтры (eq/neq/is) и выборка столбцов применяются как в PostgREST: забытый столбец в select виден тесту. */
function memoryDb(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {
    assortment_sources: [], assortment_references: [], assortment_observations: [], assortment_media: [], assortment_collections: [], ...seed,
  };
  let nextId = 1;
  const builder = (name: string) => {
    const state: { op: "select" | "insert" | "update"; payload?: unknown; filters: Array<(row: Row) => boolean>; columns: string[] | null; limit: number } =
      { op: "select", filters: [], columns: null, limit: Infinity };
    const project = (row: Row): Row => (state.columns ? Object.fromEntries(state.columns.map((c) => [c, row[c]])) : { ...row });
    const run = (): { data: Row[]; error: { code?: string; message: string } | null } => {
      const rows = (tables[name] ??= []);
      if (state.op === "insert") {
        const out: Row[] = [];
        for (const item of (Array.isArray(state.payload) ? state.payload : [state.payload]) as Row[]) {
          if (item.dedup_key !== undefined && rows.some((r) => r.dedup_key === item.dedup_key)) return { data: [], error: { code: "23505", message: "duplicate dedup_key" } };
          const row = { id: `id-${nextId++}`, ...item };
          rows.push(row);
          out.push(project(row));
        }
        return { data: out, error: null };
      }
      const matched = rows.filter((row) => state.filters.every((f) => f(row)));
      if (state.op === "update") {
        for (const row of matched) Object.assign(row, state.payload);
        return { data: matched.map(project), error: null };
      }
      return { data: matched.slice(0, state.limit).map(project), error: null };
    };
    const api = {
      select: (columns?: string) => { state.columns = columns && columns !== "*" ? columns.split(",").map((c) => c.trim()) : null; return api; },
      insert: (payload: unknown) => { state.op = "insert"; state.payload = payload; return api; },
      update: (payload: unknown) => { state.op = "update"; state.payload = payload; return api; },
      eq: (column: string, value: unknown) => { state.filters.push((r) => r[column] === value); return api; },
      neq: (column: string, value: unknown) => { state.filters.push((r) => r[column] !== value); return api; },
      limit: (n: number) => { state.limit = n; return api; },
      maybeSingle: async () => { const { data, error } = run(); return { data: data[0] ?? null, error }; },
      single: async () => { const { data, error } = run(); return { data: data[0] ?? null, error }; },
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
    };
    return api;
  };
  const storage = {
    getBucket: async () => ({ data: { public: false } }),
    from: () => ({ upload: async () => ({ error: null }), download: async () => ({ data: null, error: new Error("нет") }), remove: async () => ({ error: null }) }),
  };
  return { db: { from: builder, storage } as never, tables };
}

test("POST подборки: деньги в названии и в свободном периоде не принимаются (как при PATCH), 400 роута; обычное создаётся, база при отказе не трогается", async () => {
  const bad = [
    { kind: "custom", period: "цена 5000 ₽", title: "Сумки к лету" },
    { kind: "custom", period: "Лето", title: "Сумки по 99 USD, себестоимость низкая" },
    { kind: "bags_month", period: "2026-11", title: "План: маржа 40%" },
    { kind: "custom", period: "до 500 руб", title: null },
  ] as const;
  for (const input of bad) {
    const { db, tables } = memoryDb();
    // Ошибку берём ту, что бросила сама библиотека: тестовый импорт collections.ts и импорт из lib — разные экземпляры класса.
    const error = await createCollection(db, { direction: "bags", ...input }, "me").then(() => null, (e: unknown) => e);
    assert.ok(error instanceof Error && error.constructor.name === "CollectionInputError" && /цены и деньги/.test(error.message), JSON.stringify(input));
    assert.equal(collectionFailure(error).status, 400, "роут отвечает 400, а не 500");
    assert.equal(tables.assortment_collections.length, 0, "ничего не записано");
  }

  const { db, tables } = memoryDb();
  const made = await createCollection(db, { direction: "bags", kind: "custom", period: "  Осень   2026 ", title: " 2 рубашки-ветровки " }, "me");
  assert.equal(made.created, true);
  assert.equal(tables.assortment_collections[0].title, "2 рубашки-ветровки");
  assert.equal(tables.assortment_collections[0].period, "Осень 2026");
  const plain = memoryDb();
  await createCollection(plain.db, { direction: "bags", kind: "bags_month", period: "2026-11" }, "me");
  assert.equal(plain.tables.assortment_collections[0].title, "Сумки · ноябрь 2026", "без названия — прежнее по умолчанию");
  const again = await createCollection(plain.db, { direction: "bags", kind: "bags_month", period: "2026-11", title: "Другое" }, "me");
  assert.equal(again.created, false, "план на месяц один: повтор возвращает существующий");
});

// ——— Импорт по ссылке: сеть подменена на уровне node:https, всё остальное — настоящее (safeFetch, редиректы, разбор страницы) ———

type FakePage = { status?: number; location?: string; html?: string };

function stubWeb(pages: Record<string, FakePage>) {
  const impl = (url: URL, _options: unknown, onResponse: (response: Readable) => void) => {
    const request = Object.assign(new EventEmitter(), { end() { setImmediate(() => respond()); }, destroy(error?: Error) { if (error) request.emit("error", error); } });
    const respond = () => {
      const page = pages[url.toString()];
      if (!page) return void request.emit("error", Object.assign(new Error(`нет страницы ${url}`), { code: "ENOTFOUND" }));
      const body = Buffer.from(page.html ?? "");
      const response = Object.assign(new Readable({ read() { this.push(body); this.push(null); } }), {
        statusCode: page.status ?? 200,
        headers: page.location ? { location: page.location } : { "content-type": "text/html; charset=utf-8" },
      });
      onResponse(response);
    };
    return request;
  };
  const patches = [mock.method(https, "request", impl as never), mock.method(http, "request", impl as never)];
  return () => patches.forEach((patch) => patch.mock.restore());
}

const product = (name: string, sku: string) => `<html><head><script type="application/ld+json">${JSON.stringify({ "@type": "Product", name, sku })}</script></head></html>`;

test("Импорт по короткой ссылке: ключ считается по странице после редиректа — тот же, что у прямой ссылки; разные магазины за одним сокращателем не склеиваются", async () => {
  const restore = stubWeb({
    "https://shop-a.com/p/1": { html: product("Куртка A", "SKU1") },
    "https://bit.ly/abc": { status: 301, location: "https://shop-a.com/p/1" },
    "https://shop-b.com/p/9": { html: product("Куртка B", "SKU1") },
    "https://bit.ly/def": { status: 302, location: "https://shop-b.com/p/9" },
  });
  try {
    const { db, tables } = memoryDb();
    const viaShort = await importReference(db, { direction: "bags", url: "https://bit.ly/abc" }, null);
    assert.equal(viaShort.created, true);
    assert.equal(tables.assortment_references[0].dedup_key, "manual||shop-a.com:SKU1", "домен магазина, а не bit.ly");
    const direct = await importReference(db, { direction: "bags", url: "https://shop-a.com/p/1" }, null);
    assert.equal(direct.created, false, "та же модель по прямой ссылке — не дубль");
    assert.equal(direct.referenceId, viaShort.referenceId);
    const other = await importReference(db, { direction: "bags", url: "https://bit.ly/def" }, null);
    assert.equal(other.created, true, "другой магазин с тем же sku — другая находка");
    assert.notEqual(other.referenceId, viaShort.referenceId);
    assert.equal(tables.assortment_references.length, 2);
    assert.equal(tables.assortment_references[1].dedup_key, "manual||shop-b.com:SKU1");
  } finally {
    restore();
  }
});

test("Импорт: страница не прочиталась (закрыта) — ключ остаётся по вставленной ссылке, а не падает", async () => {
  const restore = stubWeb({ "https://shop-a.com/p/1": { status: 403 } });
  try {
    const { db, tables } = memoryDb();
    const result = await importReference(db, { direction: "bags", url: "https://shop-a.com/p/1" }, null);
    assert.equal(result.created, true);
    assert.equal(tables.assortment_references[0].dedup_key, "manual||https://shop-a.com/p/1");
  } finally {
    restore();
  }
});

test("Прежние ручные находки (ключ «manual||sku» без домена) узнаются при повторном импорте того же сайта; находка чужого сайта с тем же sku — нет", async () => {
  const restore = stubWeb({
    "https://shop-a.com/p/1": { html: product("Куртка A", "SKU1") },
    "https://shop-a.com/gb/p/1": { html: product("Куртка A", "SKU1") },
  });
  try {
    // тот же сайт, в том числе другая витрина (eu.) — старая находка найдена, дубль не создан
    for (const stored of ["https://shop-a.com/p/1", "https://eu.shop-a.com/p/1"]) {
      const { db, tables } = memoryDb({ assortment_references: [{ id: "old-1", title: "Старая находка", url: stored, dedup_key: "manual||SKU1" }] });
      const result = await importReference(db, { direction: "bags", url: "https://shop-a.com/p/1" }, null);
      assert.equal(result.created, false, stored);
      assert.equal(result.referenceId, "old-1");
      assert.equal(result.title, "Старая находка");
      assert.ok(result.warnings.some((w) => /уже есть в ленте/.test(w)));
      assert.equal(tables.assortment_references.length, 1, "дубль не создан");
    }
    // старый ключ с регионом витрины
    const regional = memoryDb({ assortment_references: [{ id: "old-gb", title: "GB", url: "https://shop-a.com/gb/p/1", dedup_key: "manual|GB|SKU1" }] });
    assert.equal((await importReference(regional.db, { direction: "bags", url: "https://shop-a.com/gb/p/1" }, null)).referenceId, "old-gb");
    // тот же старый ключ, но у находки чужой сайт (склейка двух магазинов — исходный дефект) — не она; адреса нет — не она
    for (const stored of ["https://shop-b.com/p/9", "https://shop-a.com.ua/p/1", null]) {
      const { db, tables } = memoryDb({ assortment_references: [{ id: "old-2", title: "Чужая", url: stored, dedup_key: "manual||SKU1" }] });
      const result = await importReference(db, { direction: "bags", url: "https://shop-a.com/p/1" }, null);
      assert.equal(result.created, true, String(stored));
      assert.notEqual(result.referenceId, "old-2");
      assert.equal(tables.assortment_references.length, 2);
      assert.equal(tables.assortment_references[0].dedup_key, "manual||SKU1", "чужая находка не тронута");
    }
  } finally {
    restore();
  }
});

test("Прежний ключ находки: только там, где ключ изменился (сайт вне паспорта, есть артикул); одинаковый сайт — по базовому домену", () => {
  assert.equal(legacyImportDedupKey(null, "", "SKU1", "https://shop-a.com/p/1"), "manual||SKU1");
  assert.equal(legacyImportDedupKey(null, "GB", "SKU1", "https://shop-a.com/p/1"), "manual|GB|SKU1");
  assert.equal(legacyImportDedupKey("S024", "GB", "SKU1", "https://x.com/p"), null, "паспортный источник — ключ не менялся");
  assert.equal(legacyImportDedupKey(null, "", null, "https://shop-a.com/p/1"), null, "артикула нет — ключ по адресу не менялся");
  assert.equal(sameSite("https://eu.shop-a.com/p/1", "https://shop-a.com/x"), true);
  assert.equal(sameSite("https://shop-a.com.ua/p/1", "https://shop-a.com/x"), false);
  assert.equal(sameSite("мусор", "https://shop-a.com/x"), false);
});

// ——— Базовый домен: двухуровневые зоны и общие хостинги ———

test("Базовый домен: двухуровневые зоны (.com.ua, .co.nz, .org.uk, .com.mx…), общие хостинги (myshopify.com, vercel.app…) и IP — разные сайты не сливаются", () => {
  const cases: Array<[string, string]> = [
    ["shop.brand.co.uk", "brand.co.uk"], ["www.brand.org.uk", "brand.org.uk"], ["brand.me.uk", "brand.me.uk"], ["x.brand.ltd.uk", "brand.ltd.uk"],
    ["eu.shop.com.ua", "shop.com.ua"], ["a.shop.co.nz", "shop.co.nz"], ["shop.com.mx", "shop.com.mx"], ["shop.co.za", "shop.co.za"],
    ["shop.com.sg", "shop.com.sg"], ["shop.com.ar", "shop.com.ar"], ["shop.com.co", "shop.com.co"], ["shop.co.in", "shop.co.in"],
    ["shop.co.id", "shop.co.id"], ["shop.com.my", "shop.com.my"], ["shop.com.ph", "shop.com.ph"], ["shop.com.vn", "shop.com.vn"],
    ["shop.com.tw", "shop.com.tw"], ["shop.co.il", "shop.co.il"], ["shop.com.sa", "shop.com.sa"], ["shop.com.eg", "shop.com.eg"],
    ["shop.com.pl", "shop.com.pl"], ["shop.org.au", "shop.org.au"], ["shop.net.au", "shop.net.au"], ["shop.com.ru", "shop.com.ru"],
    ["one.myshopify.com", "one.myshopify.com"], ["a.one.myshopify.com", "one.myshopify.com"], ["brand.vercel.app", "brand.vercel.app"],
    ["brand.netlify.app", "brand.netlify.app"], ["user.github.io", "user.github.io"], ["brand.pages.dev", "brand.pages.dev"],
    ["brand.herokuapp.com", "brand.herokuapp.com"], ["brand.wixsite.com", "brand.wixsite.com"], ["brand.tilda.ws", "brand.tilda.ws"],
    ["brand.tilda.cc", "brand.tilda.cc"], ["brand.blogspot.com", "brand.blogspot.com"], ["brand.webflow.io", "brand.webflow.io"],
    ["brand.wordpress.com", "brand.wordpress.com"], ["brand.ngrok.io", "brand.ngrok.io"], ["brand.workers.dev", "brand.workers.dev"],
    ["brand.fly.dev", "brand.fly.dev"], ["brand.onrender.com", "brand.onrender.com"], ["brand.azurewebsites.net", "brand.azurewebsites.net"],
    ["eng.polene-paris.com", "polene-paris.com"], ["www.rains.com", "rains.com"], ["rains.com", "rains.com"], ["localhost", "localhost"],
    ["8.8.8.8", "8.8.8.8"], ["[2606:4700:4700::1111]", "[2606:4700:4700::1111]"],
  ];
  for (const [host, base] of cases) assert.equal(baseDomain(host), base, host);
  assert.notEqual(baseDomain("a.myshopify.com"), baseDomain("b.myshopify.com"));
  assert.notEqual(baseDomain("8.8.8.8"), baseDomain("9.8.8.8"));
});

test("Каноническая ссылка и ключ находки различают разные сайты в зонах .com.ua / .co.nz и на myshopify.com", () => {
  assert.equal(trustedCanonical("https://evil.com.ua/login", "https://shop.com.ua/p/1"), null);
  assert.equal(trustedCanonical("https://evil.co.nz/login", "https://shop.co.nz/p/1"), null);
  assert.equal(trustedCanonical("https://two.myshopify.com/p/1", "https://one.myshopify.com/p/1"), null);
  assert.equal(trustedCanonical("https://eu.shop.com.ua/p/2", "https://shop.com.ua/p/1"), "https://eu.shop.com.ua/p/2", "витрина того же сайта — своя");
  const key = (page: string) => importDedupKey(null, "", "1", page, page);
  assert.notEqual(key("https://shop-a.com.ua/p/1"), key("https://shop-b.com.ua/p/1"));
  assert.notEqual(key("https://shop-a.co.nz/p/1"), key("https://shop-b.co.nz/p/1"));
  assert.notEqual(key("https://one.myshopify.com/p/1"), key("https://two.myshopify.com/p/1"));
  assert.equal(key("https://shop-a.com.ua/p/1"), "manual||shop-a.com.ua:1");
  assert.equal(key("https://eu.shop-a.com.ua/p/2"), key("https://shop-a.com.ua/p/1"), "витрины одного сайта — одна находка");
});
