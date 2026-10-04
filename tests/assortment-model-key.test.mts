import assert from "node:assert/strict";
import test from "node:test";
import { COLOR_VARIANT_SOURCES, modelKey } from "../lib/assortment/modelKey.ts";
import { constructionHead, constructionKey } from "../lib/assortment/collections.ts";
import { toCatalogCard, type CatalogRow } from "../lib/assortment/catalog.ts";
import { loadCatalog, resetHeadsFlag } from "../lib/assortment/catalogStore.ts";
import { hideCatalogItem } from "../lib/assortment/catalogPick.ts";
import { resetCatalogColumnsFlag, upsertSourceItems } from "../lib/assortment/sourceItems.ts";

const key = (sourceId: string, sourceItemId: string, title: string | null) => modelKey({ sourceId, sourceItemId, title });

// Названия ниже — реальные, из каталога на проде (04.10.2026).
test("JW PEI, Polène, Songmont: расцветки и материалы одной модели — один ключ", () => {
  assert.equal(key("S027", "1", "Carmen Top Handle Bag - Brown"), key("S027", "2", "Carmen Top Handle Bag - Black"));
  assert.equal(key("S027", "1", "Cleo Box Shape Top Handle Bag - Green Croc"), key("S027", "9", "Cleo Box Shape Top Handle Bag - Black Croc"));
  assert.equal(key("S024", "1", "Numéro Dix - Smooth Black"), key("S024", "2", "Numéro Dix - Onda Cognac"), "материал и цвет — хвост, модель одна");
  assert.equal(key("S026", "1", "Medium Song Bag"), key("S026", "2", "Medium Song Bag"), "расцветки Songmont с одним названием");
  assert.equal(key("S046", "1", "Mango faux croc leather jacket in black"), key("S046", "2", "Mango faux croc leather jacket in brown"));
});

test("Разные формы и размеры НЕ склеиваются: новая форма не прячется под старым цветом", () => {
  assert.notEqual(key("S027", "1", "Hana Large Tote Bag - Dark Brown"), key("S027", "2", "Hana Small Tote Bag - Dark Brown"), "размер — другая вещь");
  assert.notEqual(key("S024", "1", "Cyme Mini - Textured Camel"), key("S024", "2", "Cyme - Textured Camel"), "mini и обычная — разные");
  assert.notEqual(key("S046", "1", "Mango bomber jacket in brown"), key("S046", "2", "Mango faux leather jacket in brown"));
});

test("Источники «одна строка = модель» (Zara, Uniqlo, сайты РФ) по названию не склеиваются", () => {
  // «куртка женская» — общее название разных моделей на сайте РФ: склейка слила бы разные вещи.
  assert.notEqual(key("S131", "40", "куртка женская"), key("S131", "41", "куртка женская"));
  assert.equal(key("S131", "40", "куртка женская"), "S131|40");
  assert.equal(key("S001", "50", "FAUX LEATHER CROP BIKER JACKET"), "S001|50");
  assert.notEqual(key("S001", "50", "FAUX LEATHER CROP BIKER JACKET"), key("S001", "51", "FAUX LEATHER CROP BIKER JACKET"));
});

test("Ключ не пересекает источники и не склеивает короткие/пустые названия", () => {
  assert.notEqual(key("S027", "1", "Hana Large Tote Bag - Black"), key("S024", "1", "Hana Large Tote Bag - Black"), "один и тот же текст у разных источников — разные ключи (межисточниковое — этап 2)");
  assert.equal(key("S027", "77", null), "S027|77", "нет названия — строка сама по себе");
  assert.equal(key("S027", "78", "-"), "S027|78", "из названия не осталось головы");
  assert.equal(key("S046", "5", "Mini bag in black"), "S046|mini bag in black", "после среза «in black» осталось бы два слова — режем только если ≥3");
});

test("Источники «цвет = строка» — именно те, что нашёл аудит", () => {
  assert.deepEqual([...COLOR_VARIANT_SOURCES].sort(), ["S007", "S014", "S024", "S026", "S027", "S046"]);
});

test("constructionHead — общее правило: ключ конструкции подборок не изменился", () => {
  assert.equal(constructionHead("Boky - Textured Camel"), "boky");
  assert.equal(constructionKey({ brand: "Polène", title: "Boky - Textured Camel" }), "polène|boky");
  assert.equal(constructionKey({ brand: null, title: "Oversized bomber jacket in ecru" }), "|oversized bomber jacket");
  assert.equal(constructionKey({ brand: null, title: "Bomber jacket in ecru" }), "|bomber jacket in ecru", "после среза осталось бы два слова — название не режем (прежнее правило)");
});

function row(over: Partial<CatalogRow> = {}): CatalogRow {
  return { source_id: "S027", source_item_id: "1", handle: "https://x/1", title: "Carmen Top Handle Bag - Brown", product_type: null, first_seen_at: "2026-10-02T00:00:00Z", last_seen_at: "2026-10-04T00:00:00Z", baseline: true, reference_id: null, ...over };
}

test("Карточка каталога: число вариантов модели, минимум 1", () => {
  const now = Date.parse("2026-10-05T00:00:00Z");
  assert.equal(toCatalogCard(row({ variants: 22 }), undefined, now).variants, 22);
  assert.equal(toCatalogCard(row(), undefined, now).variants, 1, "у строки таблицы вариантов нет — одна");
  assert.equal(toCatalogCard(row({ variants: 0 }), undefined, now).variants, 1);
  assert.equal(toCatalogCard(row({ variants: null }), undefined, now).variants, 1);
});

// --- чтение каталога: вид голов моделей и откат на таблицу ---

type Call = { table: string; filters: string[]; select: string };

function fakeCatalogDb(opts: { headsError?: { code?: string; message: string } }) {
  const calls: Call[] = [];
  const builder = (table: string) => {
    const call: Call = { table, filters: [], select: "" };
    calls.push(call);
    const result = () => {
      if (table === "assortment_catalog_heads" && opts.headsError) return { data: null, error: opts.headsError, count: null };
      if (table === "assortment_sources") return { data: [{ source_id: "S027", name: "JW PEI", seed_urls: ["https://jwpei.com"] }], error: null };
      if (table === "assortment_catalog_stats") return { data: [], error: null };
      if (table === "assortment_references") return { data: [], error: null };
      // Только вид голов знает число вариантов модели; у строки таблицы его нет.
      return { data: [table === "assortment_catalog_heads" ? { ...row(), variants: 3 } : row()], error: null, count: 1 };
    };
    const q: Record<string, unknown> = {
      select: (columns: string) => { call.select = columns; return q; },
      eq: (c: string, v: unknown) => { call.filters.push(`eq:${c}=${v}`); return q; },
      gte: (c: string) => { call.filters.push(`gte:${c}`); return q; },
      is: (c: string) => { call.filters.push(`is:${c}`); return q; },
      not: (c: string) => { call.filters.push(`not:${c}`); return q; },
      or: () => q,
      in: () => q,
      order: () => q,
      range: () => q,
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return q;
  };
  return { db: { from: (t: string) => builder(t) } as never, calls };
}

const query = { direction: "bags" as const, sourceId: null, search: null, fresh: false, badge: false, photo: "all" as const, offset: 1, limit: 48 };

test("Каталог читает вид «голов»: модель — одна карточка, скрытие и новинка — по модели", async () => {
  resetHeadsFlag();
  const { db, calls } = fakeCatalogDb({});
  const page = await loadCatalog(db, query, Date.parse("2026-10-05T00:00:00Z"));
  const heads = calls.find((c) => c.table === "assortment_catalog_heads");
  assert.ok(heads, "читаем вид голов");
  assert.ok(heads.filters.includes("is:model_hidden_at"), "скрыта модель, а не одна расцветка");
  assert.ok(heads.filters.includes("gte:model_last_seen_at"));
  assert.match(heads.select, /first_seen_at:model_first_seen_at/, "дата — самой ранней расцветки модели");
  assert.match(heads.select, /baseline:model_baseline/);
  assert.equal(page.cards.length, 1);
  assert.equal(page.cards[0].variants, 3);
});

test("Вида ещё нет (миграция не применена) — каталог читает таблицу строк, а не падает", async () => {
  resetHeadsFlag();
  const { db, calls } = fakeCatalogDb({ headsError: { code: "PGRST205", message: "Could not find the table 'public.assortment_catalog_heads' in the schema cache" } });
  const page = await loadCatalog(db, query, Date.parse("2026-10-05T00:00:00Z"));
  assert.ok(calls.some((c) => c.table === "assortment_source_items"), "откат на таблицу строк");
  assert.equal(page.cards.length, 1);
  assert.equal(page.cards[0].variants, 1, "у строки таблицы — один вариант");
  // Второй раз сразу таблица: лишней ошибки вида нет.
  calls.length = 0;
  await loadCatalog(db, query, Date.parse("2026-10-05T00:00:00Z"));
  assert.ok(!calls.some((c) => c.table === "assortment_catalog_heads"), "10 минут не стучимся в отсутствующий вид");
  resetHeadsFlag();
});

// --- скрытие модели целиком ---

function fakeHideDb(selectResult: { data?: unknown; error?: { code?: string; message: string } | null }) {
  const updates: Array<{ patch: Record<string, unknown>; eq: string[] }> = [];
  const db = {
    from: () => ({
      select: () => {
        const q: Record<string, unknown> = { eq: () => q, maybeSingle: async () => ({ data: selectResult.data ?? null, error: selectResult.error ?? null }) };
        return q;
      },
      update: (patch: Record<string, unknown>) => {
        const eq: string[] = [];
        const q: Record<string, unknown> = {
          eq: (c: string, v: unknown) => { eq.push(`${c}=${v}`); return q; },
          select: async () => { updates.push({ patch, eq }); return { data: [{ source_id: "S027" }], error: null }; },
        };
        return q;
      },
    }),
  };
  return { db: db as never, updates };
}

test("«Не интересно» скрывает модель целиком — все расцветки по ключу модели", async () => {
  const { db, updates } = fakeHideDb({ data: { model_key: "S027|carmen top handle bag", direction: "bags" } });
  assert.equal(await hideCatalogItem(db, { sourceId: "S027", itemId: "1", hidden: true }), "ok");
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].eq, ["source_id=S027", "direction=bags", "model_key=S027|carmen top handle bag"], "по ключу модели, а не по одной строке");
  assert.ok(typeof updates[0].patch.hidden_at === "string");
});

test("Нет колонки ключа модели (миграции нет) — скрываем одну строку, как раньше", async () => {
  const { db, updates } = fakeHideDb({ error: { code: "42703", message: 'column "model_key" does not exist' } });
  assert.equal(await hideCatalogItem(db, { sourceId: "S027", itemId: "1", hidden: false }), "ok");
  assert.deepEqual(updates[0].eq, ["source_id=S027", "source_item_id=1"]);
  assert.equal(updates[0].patch.hidden_at, null, "возврат в каталог снимает скрытие");
});

// --- запись: ключ модели откатывается отдельно от колонок каталога ---

test("Нет колонки model_key — пишем без неё, а фото и бренд каталога ОСТАЮТСЯ", async () => {
  resetCatalogColumnsFlag();
  const calls: Array<Array<Record<string, unknown>>> = [];
  const db = {
    from: () => ({
      upsert: async (rows: Array<Record<string, unknown>>) => {
        calls.push(rows);
        if (rows.some((r) => "model_key" in r)) return { error: { code: "PGRST204", message: "Could not find the 'model_key' column of 'assortment_source_items' in the schema cache" } };
        return { error: null };
      },
    }),
  } as never;
  await upsertSourceItems(db, [{ source_id: "S027", source_item_id: "1", title: "a", image_urls: ["https://a"], brand: "X", model_key: "S027|a" }]);
  const last = calls[calls.length - 1];
  assert.ok(!("model_key" in last[0]), "повтор без ключа модели");
  assert.deepEqual(last[0].image_urls, ["https://a"], "фото каталога не потеряно из-за отсутствия model_key");
  assert.equal(last[0].brand, "X");
  calls.length = 0;
  await upsertSourceItems(db, [{ source_id: "S027", source_item_id: "2", model_key: "S027|b" }]);
  assert.equal(calls.length, 1, "второй раз сразу без model_key, без лишней ошибки");
  resetCatalogColumnsFlag();
});

test("Новые строки (база): model_key — в одном наборе полей у всех, недостающий — null", async () => {
  resetCatalogColumnsFlag();
  const calls: Array<Array<Record<string, unknown>>> = [];
  const db = { from: () => ({ upsert: async (rows: Array<Record<string, unknown>>) => { calls.push(rows); return { error: null }; } }) } as never;
  await upsertSourceItems(db, [
    { source_id: "S1", source_item_id: "1", baseline: true, model_key: "S1|a" },
    { source_id: "S1", source_item_id: "2", baseline: true },
  ], { fresh: true });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].map((r) => Object.keys(r).sort().join(",")), Array(2).fill("badges,baseline,brand,image_urls,model_key,source_id,source_item_id"));
  assert.equal(calls[0][1].model_key, null);
});
