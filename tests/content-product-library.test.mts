import assert from "node:assert/strict";
import test from "node:test";
import { assetUsability, canPublishAsset } from "../lib/content/assetUsability";
import { buildProductContent, countOrphanAssets } from "../lib/content/productLibrary";

/**
 * Замер по всем 9 069 строкам каталога на 05.09.2026: настоящих адресов там
 * два сорта из четырёх. Вариант CTR-теста уходит наружу — его скачивает WB, —
 * поэтому прокси-роут панели и путь `yandex-disk:` в тест не годятся, хотя
 * первый прекрасно показывается внутри.
 */
test("пригодность ссылки различает показ и выдачу наружу", () => {
  assert.equal(assetUsability("https://basket-16.wbbasket.ru/vol2621/part262145/262145449/images/big/6.webp"), "public");
  assert.equal(assetUsability("https://x.supabase.co/storage/v1/object/public/factory-media/gen/a.mp4"), "public");
  assert.equal(assetUsability("/api/lab/yandex-img?path=%2F&key=x"), "panel-only");
  assert.equal(assetUsability("yandex-disk:/content-factory/archive/2026-06-30/x.png"), "unresolved");
  assert.equal(assetUsability(""), "missing");
  assert.equal(assetUsability(null), "missing");

  assert.equal(canPublishAsset("/api/lab/yandex-img?path=x"), false, "относительный путь наружу не существует");
  assert.equal(canPublishAsset("yandex-disk:/x.png"), false);
});

test("подписанная ссылка со стороны не выдаётся за публичную", () => {
  // Прочий https может быть чем угодно, вплоть до истекающей подписи.
  assert.equal(assetUsability("https://example.com/a.png?sig=abc"), "panel-only");
});

const card = {
  nm_id: 1332992636,
  article: "HT-83-11",
  name: "Ветровка",
  subject: "Ветровки",
  photos: ["https://basket-45.wbbasket.ru/a/1.webp", "https://basket-45.wbbasket.ru/a/2.webp"],
  photos_big: ["https://basket-45.wbbasket.ru/big/1.webp", "https://basket-45.wbbasket.ru/big/2.webp"],
};

test("галерея карточки и съёмки собираются в один список товара", () => {
  const [product] = buildProductContent([card], [
    { id: 1, article: "HT-83-11", kind: "image", url: "https://x.supabase.co/storage/v1/object/public/factory-media/a.png", name: "студия", disk: "prepared", niche: null },
    { id: 2, article: "HT-83-11", kind: "image", url: "yandex-disk:/twin.png", name: "твин", disk: "product_twin", niche: null },
    { id: 3, article: "ДРУГОЙ", kind: "image", url: "https://basket-1.wbbasket.ru/x.webp", name: "чужое", disk: "wb", niche: null },
  ]);

  assert.equal(product.items.length, 4, "два кадра карточки и две свои съёмки; чужой артикул не приклеился");
  assert.equal(product.publishableCount, 3);
  assert.equal(product.galleryUnknown, false);

  assert.equal(product.items[0].isCover, true, "обложка первой");
  assert.equal(product.items[0].label, "Обложка карточки");
  assert.equal(product.items[0].url, "https://basket-45.wbbasket.ru/big/1.webp", "наружу уходит hq, а не миниатюра");
  assert.equal(product.items[0].thumbUrl, "https://basket-45.wbbasket.ru/a/1.webp", "в сетке — миниатюра");
  assert.equal(product.items.at(-1)?.usability, "unresolved", "недоступное — в конце, но не спрятано");
});

test("отсутствие галереи в базе — не то же, что отсутствие фото", () => {
  const [notCrawled] = buildProductContent([{ nm_id: 1, article: "A", name: "", subject: "" }], []);
  assert.equal(notCrawled.galleryUnknown, true, "карточку ещё не обходили после миграции");

  const [noPhotos] = buildProductContent([{ nm_id: 2, article: "B", name: "", subject: "", photos: [], photos_big: [] }], []);
  assert.equal(noPhotos.galleryUnknown, false, "обошли и убедились: фото нет");
  assert.equal(noPhotos.items.length, 0);
});

test("товар без артикула ключуется номенклатурой", () => {
  const [product] = buildProductContent([{ nm_id: 77, article: null, name: "", subject: "", photos: [], photos_big: [] }], []);
  assert.equal(product.article, "77");
});

test("файлы, не приросшие ни к одному товару, считаются, а не теряются", () => {
  const orphans = countOrphanAssets([card], [
    { id: 1, article: "HT-83-11", kind: "image", url: "https://basket-1.wbbasket.ru/a.webp", name: "", disk: "wb", niche: null },
    { id: 2, article: null, kind: "image", url: "https://basket-1.wbbasket.ru/b.webp", name: "", disk: "norvia", niche: null },
    { id: 3, article: "НЕТ-ТАКОГО", kind: "image", url: "https://basket-1.wbbasket.ru/c.webp", name: "", disk: "design", niche: null },
  ]);
  assert.equal(orphans, 2);
});
