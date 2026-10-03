import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { asCatalogItem } from "../lib/assortment/brightdataCatalog.ts";
import { classifyItem } from "../lib/assortment/crawl.ts";
import {
  limeImage, limeModelId, nextSitemapState, parseLimeCatalog, readSitemapState, RU_SHOPS, ruShopPageUrl, sitemapDiff, sitemapModelIds,
} from "../lib/assortment/ruShops.ts";

const root = join(fileURLToPath(import.meta.url), "..", "..");

/** Карточка каталога limestore.com в том виде, в каком её отдаёт сервер (03.10), с ценой рядом. */
const card = (path: string, hash: string, title: string) => `<a href="${path}" class="CatalogProduct__image-link" title="Просмотр страницы товара" aria-label="Просмотр страницы товара" data-testid="catalog:product:imageLink"><div class="CatalogProduct__preview" row-type="33"><picture data-i="0" aria-label="Товар-0"><!--[--><source srcset="https://a.cdn.lime-shine.com/p/${hash}.jpeg?w=1280&amp;q=85 1x" media="(min-width: 2560px)"><img src="https://a.cdn.lime-shine.com/p/${hash}.jpeg?w=480&amp;q=85" alt="${title}" loading="lazy" decoding="async" class="CatalogProduct__image"></picture></div></a><div class="CatalogProduct__content mediaText"><div class="CatalogProduct__title"><a href="${path}" class="">${title}<!----></a></div><div class="CatalogProduct__price">10 999 ₽</div></div>`;

const PAGE = [
  card("/ru_ru/product/37983-0302_553_610_krasnyi", "02207e46", "Сумка городского формата с отделкой тиснением"),
  card("/ru_ru/product/37983-7486_532_602_bordovyi", "10db7a98", "Сумка городского формата с отделкой тиснением"),
  card("/ru_ru/product/31449_5615_614-5615_614_603_vinnyi", "12b85fb5", "Плетеная сумка-шопер"),
  card("/ru_ru/product/31449_5615_614-5615_614_603_vinnyi", "12b85fb5", "Плетеная сумка-шопер"),
].join("<div></div>");

test("Карточки каталога Lime: модель из адреса, название, фото 1 200 px — без цены", () => {
  const records = parseLimeCatalog(PAGE);
  assert.equal(records.length, 3, "повтор той же ссылки отброшен, цвета — отдельные записи");
  assert.deepEqual(records.map((r) => r.sourceItemId), ["37983", "37983", "31449"], "цвета одной модели — один номер");
  assert.equal(records[0].url, "https://limestore.com/ru_ru/product/37983-0302_553_610_krasnyi");
  assert.equal(records[0].title, "Сумка городского формата с отделкой тиснением");
  assert.equal(records[0].brand, "LIMÉ");
  assert.equal(records[0].images[0], "https://a.cdn.lime-shine.com/p/02207e46.jpeg?w=1200&q=85");
  assert.doesNotMatch(JSON.stringify(records), /999|₽/);
  assert.deepEqual(parseLimeCatalog("<html>нет карточек</html>"), []);
});

test("Номер модели Lime и фото", () => {
  assert.equal(limeModelId("/ru_ru/product/23402_4127_294-sero_koricnevyi"), "23402");
  assert.equal(limeModelId("/ru_ru/product/35147-0568_057_402_temno_sinii"), "35147");
  assert.equal(limeModelId("/ru_ru/catalog/women_bags"), null);
  assert.equal(limeImage("https://a.cdn.lime-shine.com/p/x.jpeg?w=480&amp;q=85"), "https://a.cdn.lime-shine.com/p/x.jpeg?w=1200&q=85");
});

test("Lime: только каталог и карта сайта — страницы товаров не открываем", () => {
  const lime = RU_SHOPS.find((s) => s.sourceId === "S130")!;
  assert.equal(new URL(lime.catalogBase).hostname, "limestore.com", "lime-shop.com закрыт проверкой на бота — не трогаем");
  assert.deepEqual(lime.sections.map((s) => s.direction).sort(), ["bags", "jackets"]);
  assert.deepEqual(lime.weekdaysUtc, [1, 4]);
  assert.equal(ruShopPageUrl(lime, "women_bags", 1), "https://limestore.com/ru_ru/catalog/women_bags");
  assert.equal(ruShopPageUrl(lime, "women_bags", 3), "https://limestore.com/ru_ru/catalog/women_bags?page=3");
  const store = readFileSync(join(root, "lib/assortment/ruShopsStore.ts"), "utf8");
  assert.doesNotMatch(store, /\/product\//, "сборщик не строит адресов товаров");
  assert.match(store, /PAGE_PAUSE_MS = 1_200/);
  assert.match(store, /userAgent: ASSORTMENT_BOT_UA/, "представляемся роботом честно, не браузером");
});

test("Новые модели — по карте сайта; первый обход — база", () => {
  const xml = `<urlset><url><loc>https://limestore.com/ru_ru/catalog/women_bags</loc></url>
    <url><loc>https://limestore.com/ru_ru/product/100001-a_krasnyi</loc></url>
    <url><loc>https://limestore.com/ru_ru/product/100001-b_cernyi</loc></url>
    <url><loc> https://limestore.com/ru_ru/product/100002_x-belyi </loc></url></urlset>`;
  const now = sitemapModelIds(xml);
  assert.deepEqual([...now].sort(), ["100001", "100002"]);

  const first = sitemapDiff(readSitemapState({}), now, "2026-10-05T04:00:00Z");
  assert.equal(first.baseline, true);
  assert.equal(first.fresh.size, 0);

  const later = new Set([...now, "100003"]);
  const diff = sitemapDiff(readSitemapState({ sitemap: { models: [...now], pending: { "99999": "2026-10-01T00:00:00Z" } } }), later, "2026-10-08T04:00:00Z");
  assert.equal(diff.baseline, false);
  assert.deepEqual([...diff.fresh], ["100003"], "ушедшая из карты ждущая модель снимается");
  const next = nextSitemapState(later, diff, new Set());
  assert.deepEqual(next.pending, { "100003": "2026-10-08T04:00:00Z" }, "не увидели в каталоге — ждём");
  assert.deepEqual(nextSitemapState(later, diff, new Set(["100003"])).pending, {}, "увидели — больше не ждём");
});

test("Ждём появления в каталоге не дольше 30 дней; сотни новых разом — перестройка сайта", () => {
  const models = Array.from({ length: 1000 }, (_, i) => String(200000 + i));
  const old = sitemapDiff({ models, pending: { "200001": "2026-08-01T00:00:00Z" } }, new Set(models), "2026-10-05T00:00:00Z");
  assert.deepEqual(old.pending, {}, "ждала больше 30 дней — снята");
  const flood = new Set([...models, ...Array.from({ length: 400 }, (_, i) => String(300000 + i))]);
  const mass = sitemapDiff({ models, pending: {} }, flood, "2026-10-05T00:00:00Z");
  assert.equal(mass.massChange, true);
  assert.equal(mass.fresh.size, 0);
});

test("Русские названия раскладываются по разделам", () => {
  const item = (title: string) => asCatalogItem({ sourceItemId: "1", url: "https://limestore.com/ru_ru/product/1-a", title, brand: "LIMÉ", category: "", color: null, images: [], reviews: null, rating: null });
  assert.equal(classifyItem(item("Плетеный клатч с отделкой под кожу"), ["bags"]), "bags");
  assert.equal(classifyItem(item("Сумка-полумесяц из овечьей кожи"), ["bags"]), "bags");
  assert.equal(classifyItem(item("Рюкзак из нейлона"), ["bags"]), "bags");
  assert.equal(classifyItem(item("Кожаный ремень"), ["bags"]), null);
  assert.equal(classifyItem(item("Двубортное пальто оверсайз из шерсти"), ["jackets"]), "jackets");
  assert.equal(classifyItem(item("Тренч из хлопка"), ["jackets"]), "jackets");
  assert.equal(classifyItem(item("Укороченная косуха"), ["jackets"]), "jackets");
  assert.equal(classifyItem(item("Платье миди"), ["jackets"]), null);
});

test("Крон автообхода: первым Lime в своём отрезке времени, потом Shopify", () => {
  const route = readFileSync(join(root, "app/api/sync/assortment-crawl/route.ts"), "utf8");
  assert.match(route, /runRuShopsCrawl\(db, startedAt\.getTime\(\) \+ RU_SHOPS_BUDGET_MS, only\)/);
  assert.ok(route.indexOf("runRuShopsCrawl(") < route.indexOf("runCatalogCrawl("));
});
