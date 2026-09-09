import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  patchProductItems,
  sortContentItems,
  uploadedContentItem,
  type ContentItem,
  type ProductContent,
} from "../lib/content/productLibrary";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

/**
 * Библиотека отдаёт 2,6 МБ за восемь секунд. Пока экран после каждой правки
 * перечитывал её целиком, удалённая плитка оставалась на месте все эти восемь
 * секунд — и это читалось как «кнопка не сработала»: человек жал ещё раз или
 * шёл обновлять страницу. Сервер к тому моменту уже ответил, что сделал.
 */

const item = (url: string, usability: ContentItem["usability"] = "public"): ContentItem => ({
  key: `k:${url}`,
  url,
  thumbUrl: url,
  kind: "image",
  origin: "shoot",
  usability,
  label: url,
  isCover: false,
  frameIndex: null,
  group: "main",
  groupPinned: false,
});

const product = (nmId: number, items: ContentItem[]): ProductContent => ({
  nmId,
  article: `A-${nmId}`,
  name: "",
  subject: "",
  items,
  publishableCount: items.filter((entry) => entry.usability === "public").length,
  galleryUnknown: false,
});

test("правка по адресу идёт по всем товарам", () => {
  // Один файл каталог иногда хранит несколькими строками, и роут правит их все.
  const shared = "https://x/one.png";
  const products = [product(1, [item(shared), item("https://x/a.png")]), product(2, [item(shared)])];

  const after = patchProductItems(products, null, (items) => items.filter((entry) => entry.url !== shared));

  assert.deepEqual(after.map((entry) => entry.items.length), [1, 0], "двойник не остался ни у одного товара");
  assert.equal(after[0].publishableCount, 1, "счётчик пересчитан, а не унаследован");
});

test("правка одного товара не трогает соседей", () => {
  const products = [product(1, [item("https://x/a.png")]), product(2, [item("https://x/b.png")])];
  const after = patchProductItems(products, 2, (items) => [...items, item("https://x/new.png")]);

  assert.equal(after[0], products[0], "нетронутый товар остаётся тем же объектом");
  assert.equal(after[1].items.length, 2);
  assert.equal(after[1].publishableCount, 2);
});

test("загруженный файл собирается по тем же правилам, что и обход каталога", () => {
  const fresh = uploadedContentItem(42, "https://x.supabase.co/storage/v1/object/public/factory-media/panel-uploads/c/1/a.png", "своё фото.png");
  assert.equal(fresh.key, "shoot:42", "ключ тот же, каким его соберёт библиотека");
  assert.equal(fresh.usability, "public", "наш бакет — можно в тест");
  assert.equal(fresh.group, "main", "загрузка без номера кадра — кандидат в обложку");
  assert.equal(fresh.label, "своё фото.png");

  // Порядок общий: обложка, потом публичные, потом просмотр-только.
  const sorted = sortContentItems([item("https://x/b.png", "panel-only"), fresh, { ...item("https://x/c.png"), isCover: true }]);
  assert.deepEqual(sorted.map((entry) => entry.usability), ["public", "public", "panel-only"]);
  assert.equal(sorted[0].isCover, true);
});

test("экраны больше не перечитывают каталог ради одной плитки", () => {
  for (const file of ["components/wb/WbContentPage.tsx", "components/wb/ctr/ContentPicker.tsx"]) {
    const source = read(file);
    assert.ok(!/reloadKey/.test(source), `${file}: счётчик перечитывания убран`);
    assert.match(source, /setData\(\(current\)/, `${file}: правка применяется к своему списку`);
  }
});
