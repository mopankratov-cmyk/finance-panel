import assert from "node:assert/strict";
import test from "node:test";
import { modelHead, sampleLinks, sampleQuery } from "../lib/assortment/whereToBuy.ts";

/** «Где купить образец»: только ссылки на поиск модели, без цен и без наших фото. */

test("Запрос — бренд и модель без расцветки, бренд не дублируется", () => {
  assert.equal(modelHead("Boky - Textured Camel"), "Boky");
  assert.equal(sampleQuery({ brand: "Polène", title: "Boky - Textured Camel" }), "Polène Boky");
  assert.equal(sampleQuery({ brand: "Rains", title: "Rains Long Jacket - Black" }), "Rains Long Jacket");
  assert.equal(sampleQuery({ brand: null, title: "Находка по фото" }), "Находка по фото");
});

test("Ссылки: сайт бренда, витрины, вторичный рынок, WB; артикул — точным поиском", () => {
  const links = sampleLinks({ brand: "Polène", title: "Boky - Textured Camel", article: "000296002", url: "https://eng.polene-paris.com/products/boky-textured-camel" });
  assert.deepEqual(links.map((l) => l.label), ["Сайт бренда", "Lyst", "Farfetch", "Vinted", "eBay", "Wildberries", "Поиск по артикулу"]);
  assert.equal(links[1].url, "https://www.lyst.com/search/?q=Pol%C3%A8ne%20Boky");
  assert.match(links[6].url, /q=%22000296002%22%20Pol%C3%A8ne$/);
  for (const link of links) {
    assert.match(link.url, /^https:\/\//);
    assert.doesNotMatch(link.url, /supabase|assortment-media|price|ozon/i, "наружу не уходят наши фото, цены и Ozon");
  }
});

test("Без названия — только сайт бренда; без ссылки и названия — пусто", () => {
  assert.deepEqual(sampleLinks({ brand: null, title: "", article: null, url: "https://x.com/p" }).map((l) => l.label), ["Сайт бренда"]);
  assert.deepEqual(sampleLinks({ brand: null, title: null, article: null, url: null }), []);
});
