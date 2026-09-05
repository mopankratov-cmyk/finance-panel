import assert from "node:assert/strict";
import test from "node:test";
import { assetUsability, canPublishAsset } from "../lib/content/assetUsability";
import { buildProductContent, cardFrameIndex, countOrphanAssets, itemsForTestType } from "../lib/content/productLibrary";

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

test("номер кадра карточки читается из ссылки WB", () => {
  assert.equal(cardFrameIndex("https://basket-45.wbbasket.ru/vol1/part1/1/images/big/1.webp"), 1);
  assert.equal(cardFrameIndex("https://basket-45.wbbasket.ru/vol1/part1/1/images/hq/12.webp"), 12);
  assert.equal(cardFrameIndex("https://basket-45.wbbasket.ru/vol1/part1/1/images/c246x328/7.webp"), 7);
  assert.equal(cardFrameIndex("https://x.supabase.co/storage/v1/object/public/factory-media/a.png"), null,
    "своя съёмка — не кадр карточки");
  assert.equal(cardFrameIndex("yandex-disk:/content-factory/1.png"), null);
});

/**
 * CTR решает обложка: остальные кадры видны уже после клика и влияют на
 * конверсию, а не на кликабельность. Предлагать их вариантами CTR-теста —
 * значит предлагать эксперимент, который по построению ничего не измерит.
 */
test("в выборе для CTR-теста остаются обложка и кандидаты, но не кадры карточки", () => {
  const [product] = buildProductContent(
    [{
      nm_id: 1, article: "HT-83-11", name: "", subject: "",
      photos: ["https://basket-45.wbbasket.ru/a/1.webp", "https://basket-45.wbbasket.ru/a/2.webp"],
      photos_big: ["https://basket-45.wbbasket.ru/big/1.webp", "https://basket-45.wbbasket.ru/big/2.webp"],
    }],
    [
      // Тот же второй кадр, пришедший вторым путём — строкой каталога.
      { id: 1, article: "HT-83-11", kind: "image", url: "https://basket-16.wbbasket.ru/vol1/part1/896338397/images/big/2.webp", name: "HT-83-11 · фото 2", disk: "wb", niche: null },
      { id: 2, article: "HT-83-11", kind: "image", url: "https://x.supabase.co/storage/v1/object/public/factory-media/studio.png", name: "студия", disk: "prepared", niche: null },
    ],
  );

  const ctr = itemsForTestType(product.items, "ctr");
  assert.deepEqual(ctr.map((item) => item.label), ["Обложка карточки", "студия"]);
  assert.equal(ctr.some((item) => item.label === "Кадр карточки 2"), false, "второй кадр из галереи убран");
  assert.equal(ctr.some((item) => item.label === "HT-83-11 · фото 2"), false, "он же, пришедший каталогом, тоже убран");

  // CR и Video смотрят на всю воронку карточки — там список остаётся полным.
  assert.equal(itemsForTestType(product.items, "cr").length, product.items.length);
  assert.equal(itemsForTestType(product.items, "video").length, product.items.length);
});

test("обложка другой карточки того же артикула названа своим именем", () => {
  // У артикула бывает несколько номенклатур. Кадр тот же, файл другой — без
  // подписи это выглядит копией и провоцирует тест картинки против самой себя.
  const [product] = buildProductContent(
    [{ nm_id: 1332992636, article: "HT-83-11", name: "", subject: "",
       photos: ["https://basket-45.wbbasket.ru/vol1/part1/1332992636/images/big/1.webp"],
       photos_big: ["https://basket-45.wbbasket.ru/vol1/part1/1332992636/images/big/1.webp"] }],
    [{ id: 1, article: "HT-83-11", kind: "image", url: "https://basket-16.wbbasket.ru/vol1/part1/896338397/images/big/1.webp", name: "HT-83-11 · фото 1", disk: "wb", niche: null }],
  );
  const labels = itemsForTestType(product.items, "ctr").map((item) => item.label);
  assert.deepEqual(labels, ["Обложка карточки", "Обложка карточки 896338397"]);
});
