import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { asCatalogItem } from "../lib/assortment/brightdataCatalog.ts";
import { classifyItem } from "../lib/assortment/crawl.ts";
import { gzipSync } from "node:zlib";
import {
  limeImage, limeModelId, miniPhotoShop, miniShopsPlan, nextSitemapState, parseLimeCatalog, parseMiniShopPages, parseShopCatalog, readSitemapState, RU_SHOPS, ruShopPageUrl,
  RuShopPagesError, sitemapDiff, sitemapModelIds,
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

const fixture = (name: string) => readFileSync(join(root, "tests/fixtures/ru-shops", name), "utf8");
const shop = (id: string) => RU_SHOPS.find((s) => s.sourceId === id)!;

test("Каталоги российских брендов: модель без цвета, название, фото — без цены", () => {
  const cases: Array<[string, string, RegExp, RegExp]> = [
    ["S131", "befree.html", /^BF\d+$/, /^https:\/\/befree\.ru\/zhenskaya\/product\//],
    ["S132", "love-republic.html", /^\d{9,}$/, /^https:\/\/loverepublic\.ru\/catalog\//],
    ["S133", "zarina.html", /^ZR\d+$/, /^https:\/\/zarina\.ru\/catalog\/product\//],
    ["S134", "sela.html", /^SL\d+$/, /^https:\/\/www\.sela\.ru\/eshop\//],
    ["S135", "pompa.html", /^\d{5,}$/, /^https:\/\/www\.pompa\.ru\/catalog\/product\/\d+\/$/],
    ["S136", "askent.html", /^S\.\d+$/, /^https:\/\/askent\.ru\/cat\/sumki\/sumka_\d+\/$/],
    ["S137", "ushatava.html", /^\d+$/, /^https:\/\/www\.ushatava\.ru\/store\/w\/[a-z0-9/_-]+-\d+\/$/],
  ];
  for (const [id, file, model, url] of cases) {
    const html = fixture(file);
    const records = parseShopCatalog(shop(id), html);
    assert.ok(records.length >= 2, `${file}: ${records.length} карточек`);
    for (const r of records) {
      assert.match(r.sourceItemId, model, `${file}: модель ${r.sourceItemId}`);
      assert.match(r.url, url, `${file}: ссылка ${r.url}`);
      assert.ok(r.title.length > 3 && !/₽|\d{3,} ?руб/.test(r.title), `${file}: название «${r.title}»`);
      assert.match(r.images[0] ?? "", /^https:\/\//, `${file}: фото`);
    }
    assert.match(html, /₽|price/i, `${file}: в разметке рядом есть цена`);
    assert.doesNotMatch(JSON.stringify(records), /price|₽/i, `${file}: в записи цены нет`);
  }
  assert.match(parseShopCatalog(shop("S131"), fixture("befree.html"))[0].images[0], /\/images\/1280\//, "befree — фото 1 280 px");
  assert.doesNotMatch(parseShopCatalog(shop("S135"), fixture("pompa.html"))[0].title, / - \d+$/, "Pompa: номер из data-name срезан");
});

test("Российские магазины: свои дни, разрешённая постраничная выдача, закрытые не трогаем", () => {
  const ids = RU_SHOPS.map((s) => s.sourceId);
  assert.deepEqual(ids, ["S130", "S131", "S132", "S133", "S134", "S135", "S136", "S137"]);
  assert.equal(ruShopPageUrl(shop("S135"), "outerwear/", 2), "https://www.pompa.ru/catalog/outerwear/?PAGEN_1=2");
  assert.equal(ruShopPageUrl(shop("S133"), "clothes/outwear/kurtki/", 3), "https://zarina.ru/catalog/clothes/outwear/kurtki/?page=3");
  const text = JSON.stringify(RU_SHOPS);
  assert.doesNotMatch(text, /12storeez|gloria-jeans|ekonika|finn-flare|mascotte|lime-shop\.com/, "сайты с проверкой на бота не обходим");
  for (const s of RU_SHOPS) {
    assert.ok(s.sections.some((x) => x.direction === "bags") || s.sections.some((x) => x.direction === "jackets"));
    assert.ok(s.weekdaysUtc.length > 0 && s.maxPages <= 40);
  }
  // В день — не больше двух магазинов на Vercel: у крона на сайты брендов 150 с (mini — отдельно).
  for (let day = 0; day < 7; day += 1) {
    const shops = RU_SHOPS.filter((s) => s.via !== "mini" && s.weekdaysUtc.includes(day));
    assert.ok(shops.length <= 2, `день ${day}: ${shops.map((s) => s.name).join(", ")}`);
    if (shops.some((s) => s.sourceId === "S130" || s.sourceId === "S135")) assert.equal(shops.length, 1, "Lime и Pompa — по одному в день");
  }
});

test("Сайты, не пускающие облако, приносит загрузчик на mini; план — по дням магазина", () => {
  assert.deepEqual(RU_SHOPS.filter((s) => s.via === "mini").map((s) => s.sourceId), ["S131", "S132", "S133", "S134", "S136", "S137"]);
  const tuesday = miniShopsPlan(new Date("2026-10-06T03:00:00Z"));
  assert.deepEqual(tuesday.map((s) => s.sourceId), ["S131", "S132", "S137"]);
  assert.equal(tuesday[0].sections[0].urls[1], "https://befree.ru/zhenskaya/zen-riukzaki-i-sumki?page=2");
  assert.equal(tuesday[0].sections[0].urls.length, shop("S131").maxPages);
  assert.deepEqual(miniShopsPlan(new Date("2026-10-05T03:00:00Z")).map((s) => s.sourceId), ["S136"], "понедельник: Lime на Vercel, Askent — с mini");
  assert.equal(miniShopsPlan(new Date("2026-10-06T03:00:00Z"), { all: true }).length, 6);
  assert.deepEqual(miniShopsPlan(new Date("2026-10-05T03:00:00Z"), { only: "S134" }).map((s) => s.sourceId), ["S134"]);
  for (const plan of miniShopsPlan(new Date(), { all: true })) {
    const html = fixture({ S131: "befree.html", S132: "love-republic.html", S133: "zarina.html", S134: "sela.html", S136: "askent.html", S137: "ushatava.html" }[plan.sourceId]!);
    assert.ok((html.match(new RegExp(plan.cardHref, "g")) ?? []).length >= 2, `${plan.name}: адрес карточки находится`);
  }
  const store = readFileSync(join(root, "lib/assortment/ruShopsStore.ts"), "utf8");
  assert.match(store, /if \(shop\.via === "mini"\) continue;/, "крон на Vercel их не трогает");
});

test("Посылка загрузчика: только его магазины и разделы паспорта, не больше потолка", () => {
  const ok = parseMiniShopPages({ sourceId: "S133", sections: [{ slug: "sumki-i-koshelki/", pages: ["<html>1</html>", "<html>2</html>"] }] });
  assert.equal(ok.shop.name, "ZARINA");
  assert.deepEqual(ok.pages.get("sumki-i-koshelki/"), ["<html>1</html>", "<html>2</html>"]);
  assert.throws(() => parseMiniShopPages({ sourceId: "S130", sections: [{ slug: "women_bags", pages: [] }] }), RuShopPagesError, "Lime — не через mini");
  assert.throws(() => parseMiniShopPages({ sourceId: "S133", sections: [{ slug: "../admin", pages: [] }] }), RuShopPagesError);
  assert.throws(() => parseMiniShopPages({ sourceId: "S133", sections: [{ slug: "sumki-i-koshelki/", pages: Array(40).fill("x") }] }), RuShopPagesError);
  assert.throws(() => parseMiniShopPages({ sourceId: "S133", sections: [] }), RuShopPagesError);
  // Посылка сжата: страница в ~0,5 МБ HTML сжимается многократно.
  const page = fixture("love-republic.html").repeat(30);
  assert.ok(gzipSync(page).length * 5 < page.length);
  const route = readFileSync(join(root, "app/api/assortment-collector/ru-shops/route.ts"), "utf8");
  assert.match(route, /gunzipSync\(packed, \{ maxOutputLength: MAX_UNPACKED_BYTES \}\)/);
  assert.match(route, /checkAssortmentCollectorAuth\(request\)/);
});

test("Фото, которые облаку не отдали, приносит mini: только своему магазину и с его CDN", () => {
  for (const shop of RU_SHOPS) {
    const records = parseShopCatalog(shop, shop.sourceId === "S130" ? PAGE : fixture({ S131: "befree.html", S132: "love-republic.html", S133: "zarina.html", S134: "sela.html", S135: "pompa.html", S136: "askent.html", S137: "ushatava.html" }[shop.sourceId]!));
    for (const r of records) assert.ok(r.images.every((src) => shop.imageHosts.includes(new URL(src).hostname)), `${shop.name}: фото ${r.images[0]} не с его CDN`);
  }
  assert.equal(miniPhotoShop("S131", "https://imgcdn.befree.ru/rest/V1/images/1280/product/images/BF1/BF1_20_1.jpg")?.name, "befree");
  assert.equal(miniPhotoShop("S131", "https://evil.example/x.jpg"), null, "чужой адрес");
  assert.equal(miniPhotoShop("S131", "http://imgcdn.befree.ru/x.jpg"), null, "только https");
  assert.equal(miniPhotoShop("S130", "https://a.cdn.lime-shine.com/p/x.jpeg"), null, "Lime — не через mini");
  assert.equal(miniPhotoShop("S999", "https://imgcdn.befree.ru/x.jpg"), null);
  const store = readFileSync(join(root, "lib/assortment/ruShopsStore.ts"), "utf8");
  assert.match(store, /ref\.created_by !== "crawler"/, "только находки обхода");
  assert.match(store, /if \(\(count \?\? 0\) > 0\) return 0;/, "фото уже есть — не трогаем");
  assert.match(store, /sniffImageMime\(input\.bytes\)/, "байты — картинка");
  const crawl = readFileSync(join(root, "lib/assortment/brightdataCrawl.ts"), "utf8");
  assert.match(crawl, /created\.photos === 0 && r\.images\.length > 0\) missingPhotos\.push/);
});

// --- полнота обхода раздела: «пусто» — это сбой, а не «в разделе ничего нет» ---

test("crawlSection: заглушка или антибот-страница с кодом 200 на первой странице — обход НЕ полный", async () => {
  const { crawlSection } = await import("../lib/assortment/ruShopsStore.ts");
  const befree = shop("S131");
  const stub = await crawlSection(befree, "zen-riukzaki-i-sumki", Date.now() + 60_000, async () => "<html><body>Проверка браузера…</body></html>");
  assert.equal(stub.records.length, 0);
  assert.equal(stub.complete, false, "ноль карточек на первой странице — не «раздел пуст», а сбой: «полный» обход стёр бы раздел из истории");
  assert.equal(stub.pages, 1);
});

test("crawlSection: раздел кончился после карточек — полный; упёрлись в потолок страниц — нет", async () => {
  const { crawlSection } = await import("../lib/assortment/ruShopsStore.ts");
  const befree = shop("S131");
  const html = fixture("befree.html");
  // Страница 1 — карточки, страница 2 — те же (новых нет): раздел закончился.
  const ended = await crawlSection(befree, "x", Date.now() + 60_000, async () => html);
  assert.ok(ended.records.length >= 2);
  assert.equal(ended.complete, true);
  assert.equal(ended.pages, 2);
  // Потолок в одну страницу: новые карточки ещё были — раздел обрезан.
  const capped = await crawlSection({ ...befree, maxPages: 1 }, "x", Date.now() + 60_000, async () => html);
  assert.equal(capped.complete, false);
  // Дедлайн и «страница не отдалась» — тоже неполный обход.
  assert.equal((await crawlSection(befree, "x", Date.now() - 1, async () => html)).complete, false);
  assert.equal((await crawlSection(befree, "x", Date.now() + 60_000, async () => null)).complete, false);
});
