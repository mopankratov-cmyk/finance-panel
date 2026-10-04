import assert from "node:assert/strict";
import test from "node:test";
import { catalogFields, groupBySameKeys, resetCatalogColumnsFlag, upsertSourceItems } from "../lib/assortment/sourceItems.ts";

test("Поля каталога: только непустое, только https, до 4 фото — пустое не затирает собранное", () => {
  assert.deepEqual(catalogFields({ images: ["https://a/1.jpg", "http://a/2.jpg", "https://a/1.jpg", "https://a/3.jpg", "https://a/4.jpg", "https://a/5.jpg", "https://a/6.jpg"], brand: "  Zara ", badges: ["new", "new"] }), {
    image_urls: ["https://a/1.jpg", "https://a/3.jpg", "https://a/4.jpg", "https://a/5.jpg"],
    brand: "Zara",
    badges: ["new"],
  });
  assert.deepEqual(catalogFields({ images: [], brand: "", badges: [] }), {}, "обход без фото не пишет image_urls вовсе");
  assert.deepEqual(catalogFields({}), {});
  assert.deepEqual(catalogFields({ badges: [], badgesKnown: true }), { badges: null }, "Shopify прочитал теги — «меток нет» пишется, снятая метка снимается");
  assert.deepEqual(catalogFields({ badges: [] }), {}, "Bright Data и сайты РФ меток не читают — не трогаем");
  assert.deepEqual(catalogFields({ images: [], imagesKnown: true }), { image_urls: null }, "полная запись набора без живых фото — ссылки снимаются");
  assert.deepEqual(catalogFields({ images: [] }), {}, "обход без фото не затирает собранные");
});

test("Пачки с одинаковым набором полей: строка без фото не попадёт в пачку с фото", () => {
  const groups = groupBySameKeys([
    { source_id: "S1", source_item_id: "1", image_urls: ["https://a"] },
    { source_id: "S1", source_item_id: "2" },
    { source_item_id: "3", source_id: "S1", image_urls: ["https://b"] },
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((g) => g.map((r) => r.source_item_id)), [["1", "3"], ["2"]]);
});

function fakeDb(missingColumns: boolean) {
  const calls: Array<Array<Record<string, unknown>>> = [];
  const db = {
    from: () => ({
      upsert: async (rows: Array<Record<string, unknown>>) => {
        calls.push(rows);
        if (missingColumns && rows.some((r) => "image_urls" in r || "brand" in r)) return { error: { code: "PGRST204", message: "Could not find the 'image_urls' column of 'assortment_source_items' in the schema cache" } };
        return { error: null };
      },
    }),
  };
  return { db: db as never, calls };
}

test("До миграции обход не падает: поля каталога отбрасываются, запись повторяется", async () => {
  resetCatalogColumnsFlag();
  const { db, calls } = fakeDb(true);
  await upsertSourceItems(db, [
    { source_id: "S1", source_item_id: "1", title: "a", image_urls: ["https://a"], brand: "X" },
    { source_id: "S1", source_item_id: "2", title: "b" },
  ]);
  const last = calls[calls.length - 1];
  assert.equal(last.length, 2, "без колонок каталога обе строки — одна пачка");
  assert.ok(last.every((r) => !("image_urls" in r) && !("brand" in r)), "повтор — без колонок каталога");
  calls.length = 0;
  await upsertSourceItems(db, [{ source_id: "S1", source_item_id: "3", image_urls: ["https://c"] }]);
  assert.equal(calls.length, 1, "второй раз сразу без колонок, без лишней ошибки");
  assert.ok(!("image_urls" in calls[0][0]));
  resetCatalogColumnsFlag();
});

test("Новые строки (база) — одной записью с одним набором полей: недописанная половина не станет «новинками»", async () => {
  resetCatalogColumnsFlag();
  const { db, calls } = fakeDb(false);
  await upsertSourceItems(db, [
    { source_id: "S1", source_item_id: "1", baseline: true, image_urls: ["https://a"], brand: "X" },
    { source_id: "S1", source_item_id: "2", baseline: true, brand: "X" },
    { source_id: "S1", source_item_id: "3", baseline: true },
  ], { fresh: true });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].map((r) => Object.keys(r).sort().join(",")), Array(3).fill("badges,baseline,brand,image_urls,source_id,source_item_id"));
  assert.equal(calls[0][1].image_urls, null);
  assert.deepEqual(calls[0][0].image_urls, ["https://a"]);
});

test("Колонок нет: помним 10 минут, потом проверяем снова; ошибка про чужую колонку — не наш случай", async () => {
  resetCatalogColumnsFlag();
  const realNow = Date.now;
  try {
    const { db, calls } = fakeDb(true);
    await upsertSourceItems(db, [{ source_id: "S1", source_item_id: "1", image_urls: ["https://a"] }]);
    calls.length = 0;
    await upsertSourceItems(db, [{ source_id: "S1", source_item_id: "2", image_urls: ["https://a"] }]);
    assert.equal(calls.length, 1, "в течение 10 минут — сразу без колонок");
    Date.now = () => realNow() + 11 * 60 * 1000;
    calls.length = 0;
    await upsertSourceItems(db, [{ source_id: "S1", source_item_id: "3", image_urls: ["https://a"] }]);
    assert.equal(calls.length, 2, "через 10 минут снова пробуем с колонками (миграцию могли применить)");
  } finally {
    Date.now = realNow;
    resetCatalogColumnsFlag();
  }
  const other = { from: () => ({ upsert: async () => ({ error: { code: "PGRST204", message: "Could not find the 'published_at' column of 'assortment_source_items' in the schema cache" } }) }) } as never;
  await assert.rejects(upsertSourceItems(other, [{ source_id: "S1", source_item_id: "1", image_urls: ["https://a"] }]), /published_at/, "чужая колонка — не повод выбрасывать поля каталога");
  resetCatalogColumnsFlag();
});

test("После миграции поля каталога пишутся; пачки по 500", async () => {
  resetCatalogColumnsFlag();
  const { db, calls } = fakeDb(false);
  const rows = Array.from({ length: 1001 }, (_, i) => ({ source_id: "S1", source_item_id: String(i), image_urls: ["https://a"] }));
  await upsertSourceItems(db, rows);
  assert.deepEqual(calls.map((c) => c.length), [500, 500, 1]);
  assert.ok(calls[0].every((r) => Array.isArray(r.image_urls)));
});

test("Чужая ошибка базы не глотается", async () => {
  resetCatalogColumnsFlag();
  const db = { from: () => ({ upsert: async () => ({ error: { code: "23505", message: "duplicate" } }) }) } as never;
  await assert.rejects(upsertSourceItems(db, [{ source_id: "S1", source_item_id: "1", image_urls: ["https://a"] }]), /duplicate/);
});
