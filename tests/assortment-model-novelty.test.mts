import assert from "node:assert/strict";
import test from "node:test";
import { crawlPlan, type CatalogItem } from "../lib/assortment/crawl.ts";
import { ingestRecords } from "../lib/assortment/brightdataCrawl.ts";
import { modelKey, newModelsOnly } from "../lib/assortment/modelKey.ts";
import { clearDirection, loadKnownModelKeys, resetCatalogColumnsFlag } from "../lib/assortment/sourceItems.ts";
import type { MappedRecord } from "../lib/assortment/brightdataCatalog.ts";

const key = (sourceId: string, sourceItemId: string, title: string) => modelKey({ sourceId, sourceItemId, title });

test("Расцветка известной модели — не новинка; две новые расцветки одной новой модели — одна новинка", () => {
  const known = new Set([key("S027", "1", "Carmen Top Handle Bag - Brown")]);
  const items = [
    { id: "2", title: "Carmen Top Handle Bag - Apricot" },
    { id: "3", title: "Hana Large Tote Bag - Black" },
    { id: "4", title: "Hana Large Tote Bag - Navy" },
    { id: "5", title: "Hana Small Tote Bag - Black" },
  ];
  const split = newModelsOnly(items, (i) => key("S027", i.id, i.title), known);
  assert.deepEqual(split.fresh.map((i) => i.id), ["3", "5"], "Hana Large и Hana Small — две разные модели; Carmen известна");
  assert.deepEqual(split.sameModel.map((i) => i.id), ["2", "4"], "новый цвет Carmen и второй цвет Hana Large — база, не новинка");
});

test("Источники «одна строка = модель» (Zara, сайты РФ): каждая новая строка — новая модель", () => {
  const items = [{ id: "10", title: "куртка женская" }, { id: "11", title: "куртка женская" }];
  const split = newModelsOnly(items, (i) => key("S131", i.id, i.title), new Set());
  assert.equal(split.fresh.length, 2, "общее название у разных моделей не склеивается");
  assert.equal(split.sameModel.length, 0);
});

test("Shopify: новый цвет известной модели из плана новинок переходит в «базу»", () => {
  const item = (id: string, title: string): CatalogItem => ({ sourceItemId: id, handle: id, title, productType: "", tags: [], publishedAt: new Date().toISOString() });
  const fetched = [item("1", "Boky - Textured Camel"), item("2", "Boky - Textured Black"), item("3", "Numéro Dix - Onda Cognac")];
  const plan = crawlPlan(new Set(["1"]), fetched);
  assert.deepEqual(plan.fresh.map((i) => i.sourceItemId), ["2", "3"], "по id обе строки новые");
  const known = new Set([key("S024", "1", "Boky - Textured Camel")]);
  const split = newModelsOnly(plan.fresh, (i) => key("S024", i.sourceItemId, i.title), known);
  assert.deepEqual(split.fresh.map((i) => i.sourceItemId), ["3"], "новинка — только Numéro Dix");
  assert.deepEqual(split.sameModel.map((i) => i.sourceItemId), ["2"], "новая расцветка Boky — не новинка");
});

// --- поддельная база: цепочка supabase-js, которой пользуются обход и снимок наблюдений ---

interface KnownRow { source_item_id: string; baseline: boolean; reference_id: string | null; first_seen_at: string; model_key?: string | null }

function fakeDb(rows: KnownRow[], opts: { modelKeyColumn?: boolean } = {}) {
  const upserts: Array<Array<Record<string, unknown>>> = [];
  const updates: Array<{ patch: Record<string, unknown>; filters: string[] }> = [];
  const hasModelKey = opts.modelKeyColumn !== false;
  const db = {
    from: (table: string) => {
      const state = { op: "select", cols: "", filters: [] as string[], patch: null as Record<string, unknown> | null };
      const q: Record<string, unknown> = {
        select: (cols: string) => { state.cols = cols; return q; },
        eq: (c: string, v: unknown) => { state.filters.push(`${c}=${v}`); return q; },
        not: () => q,
        in: (c: string, v: unknown[]) => { state.filters.push(`${c} in ${JSON.stringify(v)}`); return q; },
        order: () => q,
        range: () => q,
        update: (patch: Record<string, unknown>) => { state.op = "update"; state.patch = patch; return q; },
        upsert: async (data: Array<Record<string, unknown>>) => { if (table === "assortment_source_items") upserts.push(data); return { error: null }; },
        insert: async () => ({ error: null }),
        then: (resolve: (v: unknown) => unknown) => {
          if (state.op === "update") {
            updates.push({ patch: state.patch ?? {}, filters: state.filters });
            return Promise.resolve({ data: null, error: null }).then(resolve);
          }
          if (state.cols === "model_key") {
            if (!hasModelKey) return Promise.resolve({ data: null, error: { code: "42703", message: 'column "model_key" does not exist' } }).then(resolve);
            return Promise.resolve({ data: rows.filter((r) => r.model_key).map((r) => ({ model_key: r.model_key })), error: null }).then(resolve);
          }
          return Promise.resolve({ data: rows, error: null }).then(resolve);
        },
      };
      return q;
    },
  };
  return { db: db as never, upserts, updates };
}

const rec = (sourceItemId: string, title: string): MappedRecord => ({ sourceItemId, url: `https://x/${sourceItemId}`, title, brand: "Mango", category: "", color: null, images: [], reviews: null, rating: null } as MappedRecord);
const known = (id: string, title: string, over: Partial<KnownRow> = {}): KnownRow => ({ source_item_id: id, baseline: true, reference_id: null, first_seen_at: "2026-10-03T00:00:00Z", model_key: key("S046", id, title), ...over });
const deadline = () => Date.now() + 60_000;

test("ASOS: новая расцветка известной модели ложится базой, новая модель — новинкой (ingestRecords)", async () => {
  resetCatalogColumnsFlag();
  const { db, upserts } = fakeDb([known("A1", "Mango bomber jacket in brown")]);
  await ingestRecords(db, { sourceId: "S046", name: "ASOS" }, { direction: "jackets", method: "brightdata_asos" }, [
    rec("A1", "Mango bomber jacket in brown"),
    rec("A2", "Mango bomber jacket in navy"),
    rec("B1", "Mango denim jacket in blue"),
  ], deadline(), { drainOrphans: false });
  const inserted = upserts.flat().filter((r) => r.baseline !== undefined);
  const baselineOf = (id: string) => inserted.find((r) => r.source_item_id === id)?.baseline;
  assert.equal(baselineOf("A2"), true, "новый цвет известной модели — база, а не новинка в ленту");
  assert.equal(baselineOf("B1"), false, "новая модель — новинка");
});

test("До миграции (нет колонки model_key) обход не падает: каждая расцветка по-прежнему отдельная строка", async () => {
  resetCatalogColumnsFlag();
  const { db, upserts } = fakeDb([known("A1", "Mango bomber jacket in brown", { model_key: null })], { modelKeyColumn: false });
  await ingestRecords(db, { sourceId: "S046", name: "ASOS" }, { direction: "jackets", method: "brightdata_asos" }, [
    rec("A1", "Mango bomber jacket in brown"),
    rec("A2", "Mango bomber jacket in navy"),
  ], deadline(), { drainOrphans: false });
  const inserted = upserts.flat().filter((r) => r.baseline !== undefined);
  assert.equal(inserted.find((r) => r.source_item_id === "A2")?.baseline, false, "без ключей модели прежнее поведение");
});

test("Прежний мусор в разделе (штаны) снимается из раздела, а не висит 30 дней", async () => {
  resetCatalogColumnsFlag();
  const { db, updates } = fakeDb([known("P1", "Puffer Pants Black"), known("J1", "Mango bomber jacket in brown")]);
  await ingestRecords(db, { sourceId: "S046", name: "ASOS" }, { direction: "jackets", method: "brightdata_asos" }, [
    rec("P1", "Puffer Pants Black"),
    rec("J1", "Mango bomber jacket in brown"),
  ], deadline(), { drainOrphans: false });
  const cleared = updates.find((u) => u.patch.direction === null);
  assert.ok(cleared, "раздел снят");
  assert.ok(cleared.filters.some((f) => f.includes('"P1"')) && !cleared.filters.some((f) => f.includes('"J1"')), "только у штанов, куртка не тронута");
});

test("loadKnownModelKeys: ключи известных моделей; нет колонки — пусто, не ошибка", async () => {
  const withKeys = fakeDb([known("A1", "Mango bomber jacket in brown"), known("A2", "Mango denim jacket in blue")]);
  assert.deepEqual([...await loadKnownModelKeys(withKeys.db, "S046", "jackets")].sort(), ["S046|mango bomber jacket", "S046|mango denim jacket"]);
  const noColumn = fakeDb([known("A1", "x")], { modelKeyColumn: false });
  assert.equal((await loadKnownModelKeys(noColumn.db, "S046")).size, 0);
});

test("clearDirection: пачками по 200, раздел становится null", async () => {
  const { db, updates } = fakeDb([]);
  const ids = Array.from({ length: 450 }, (_, i) => `id${i}`);
  assert.equal(await clearDirection(db, "S014", ids), 450);
  assert.equal(updates.length, 3, "200 + 200 + 50");
  assert.ok(updates.every((u) => u.patch.direction === null));
  assert.equal(await clearDirection(db, "S014", []), 0);
});
