import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripMoney } from "../lib/assortment/brightdata.ts";
import { brightdataRunLog, clearDeadZaraPhotos, collectBrightData, requestZaraPhotos, triggerBrightData, triggerZaraPhotos } from "../lib/assortment/brightdataCrawl.ts";
import {
  asCatalogItem, BRIGHTDATA_TARGETS, coverageKey, datasetVerdict, filterSignature, keepPartRecord, looksLikeChurn, mapRecord, novelCandidates, partRecords, purchaseKey, readBought, readCoverage,
  readPending, readTriggerFailure, targetSignature, triggerFailureNote, uniqueRecords, writeCoverage, writePending, pendingAlive, readPhotoPending, BILLING_HOLD_TTL_MS,
} from "../lib/assortment/brightdataCatalog.ts";
import { classifyItem } from "../lib/assortment/crawl.ts";
import { modelKey } from "../lib/assortment/modelKey.ts";
import { cardSignal } from "../lib/assortment/signals.ts";

/** Сбор ASOS и H&M через Bright Data: ср и сб, без цен, первый сбор — база. */

const root = fileURLToPath(new URL("..", import.meta.url));

test("Запись ASOS: название, бренд, фото, отзывы — без цен", () => {
  const record = mapRecord(stripMoney({
    url: "https://www.asos.com/pull-bear/pull-bear-contrast-shopper-bag/prd/123?clr=taupe", name: "Pull&Bear Contrast shopper bag in taupe",
    brand: "Pull&Bear", product_id: 123, category: "Accessories", color: "taupe", image: "https://images.asos-media.com/a.jpg",
    additional_image_urls: ["https://images.asos-media.com/b.jpg", "https://images.asos-media.com/a.jpg"], review_count: 152, star_rating: 4.4,
    final_price: 29.99, currency: "GBP",
  }));
  assert.ok(record);
  assert.equal(record.url, "https://www.asos.com/pull-bear/pull-bear-contrast-shopper-bag/prd/123");
  assert.equal(record.sourceItemId, "123");
  assert.deepEqual(record.images, [
    "https://images.asos-media.com/a.jpg?$n_1920w$&wid=1200&fit=constrain",
    "https://images.asos-media.com/b.jpg?$n_1920w$&wid=1200&fit=constrain",
  ]);
  assert.equal(record.reviews, 152);
  assert.doesNotMatch(JSON.stringify(record), /29\.99|GBP|price/);
});

test("Запись H&M: product_name, main_image, image_urls; ошибочная запись — пропуск", () => {
  const record = mapRecord({ url: "https://www2.hm.com/en_us/productpage.1234.html", product_name: "Car Coat", product_code: "1234", category: "Coats", main_image: "https://image.hm.com/1.jpg", image_urls: ["https://image.hm.com/2.jpg"], reviews_count: "37" });
  assert.equal(record?.title, "Car Coat");
  assert.equal(record?.reviews, 37);
  assert.equal(record?.images.length, 2);
  assert.equal(mapRecord({ error: "Crawler error", input: { url: "x" } }), null);
  assert.equal(mapRecord({ url: "https://x", name: "" }), null);
});

test("Раздел проверяется по названию: кошелёк из запроса «tote bag» в сумки не идёт", () => {
  const wallet = mapRecord({ url: "https://www.asos.com/x/prd/9", name: "Leather card holder wallet", category: "Accessories" })!;
  const tote = mapRecord({ url: "https://www.asos.com/x/prd/8", name: "Canvas tote bag", category: "Accessories" })!;
  assert.equal(classifyItem(asCatalogItem(wallet), ["bags"]), null);
  assert.equal(classifyItem(asCatalogItem(tote), ["bags"]), "bags");
});

test("Запущенные пробы хранятся в capabilities, остальное в нём не трогаем", () => {
  const caps = writePending({ discovery: "supported" }, [{ snapshotId: "sd_1", datasetId: "gd_1", direction: "bags", method: "brightdata_asos", triggeredAt: "2026-10-07T05:00:00Z" }]);
  assert.equal(caps.discovery, "supported");
  assert.equal(readPending(caps).length, 1);
  assert.deepEqual(readPending({ brightdata_pending: [{ snapshotId: 1 }] }), []);
  assert.deepEqual(readPending(null), []);
});

test("Цели сбора: Zara и Uniqlo (наборы), ASOS и H&M паспорта, разумные лимиты, без Ozon", () => {
  const sources = new Set(BRIGHTDATA_TARGETS.map((t) => t.sourceId));
  assert.deepEqual([...sources].sort(), ["S001", "S003", "S007", "S046"]);
  const collect = BRIGHTDATA_TARGETS.filter((t) => t.kind !== "dataset").reduce((s, t) => s + t.limitPerInput * t.inputs.length, 0);
  const dataset = BRIGHTDATA_TARGETS.filter((t) => t.kind === "dataset").reduce((s, t) => s + (t.recordsLimit ?? 0), 0);
  assert.ok(collect <= 200, `сборщики: ${collect} записей за прогон`);
  // Потолок, а не расход: платим за пришедшие записи. Основные разделы — 2 000 (не больше $5 в неделю); части разделов (CHAQUETA Zara,
  // коллаборации Uniqlo, решение владельца 06.10) — ещё до 900, всего не больше $7,5 в неделю, ожидаемо намного меньше.
  const main = BRIGHTDATA_TARGETS.filter((t) => t.kind === "dataset" && !t.part).reduce((s, t) => s + (t.recordsLimit ?? 0), 0);
  assert.ok(main <= 2000, `основные разделы наборов: потолок ${main} записей в неделю`);
  assert.ok(dataset <= 3000, `наборы: потолок ${dataset} записей в неделю`);
  assert.ok(BRIGHTDATA_TARGETS.every((t) => t.kind !== "dataset" || ((t.recordsLimit ?? 0) > 0 && (t.recordsLimit ?? 0) <= 1000)), "выборка набора — до 1 000 записей");
  assert.doesNotMatch(JSON.stringify(BRIGHTDATA_TARGETS), /ozon/i);
});

test("Zara — готовый набор раз в неделю: женское, без кардиганов, одна витрина", () => {
  const zara = BRIGHTDATA_TARGETS.filter((t) => t.sourceId === "S001");
  assert.ok(zara.every((t) => t.kind === "dataset" && t.weekdayUtc === 3));
  const text = JSON.stringify(zara.map((t) => t.filter));
  assert.match(text, /"WOMAN"/);
  assert.match(text, /CAZADORA/);
  assert.match(text, /BOLSO/);
  assert.doesNotMatch(JSON.stringify(zara.filter((t) => !t.part).map((t) => t.filter)), /CHAQUETA/, "основная выборка курток — без CHAQUETA: там кардиганы, она — отдельной частью");
  assert.ok(zara.every((t) => JSON.stringify(t.filter).includes('"/us/en/"')), "товар повторяется по странам — одна витрина, чтобы раздел влез целиком");
  const jackets = JSON.stringify(zara.find((t) => t.direction === "jackets" && !t.part)!.filter);
  assert.match(jackets, /"availability","operator":"=","value":true/, "куртки одной витрины с распроданным не влезли в 600 записей");
});

test("Запись набора Zara: product_name, product_family, colour; цены вырезаны", () => {
  const record = mapRecord(stripMoney({ product_id: 5070666, product_name: "BOMBER JACKET WITH TABS", url: "https://www.zara.com/us/en/bomber-jacket-with-tabs-p05070666.html", product_family: "CAZADORA", colour: "Ecru", image: ["https://static.zara.net/a.jpg"], price: 59.9 }))!;
  assert.equal(record.title, "BOMBER JACKET WITH TABS");
  assert.equal(record.category, "CAZADORA");
  assert.equal(record.color, "Ecru");
  assert.equal(record.sourceItemId, "5070666");
  assert.doesNotMatch(JSON.stringify(record), /59\.9|price/);
});

test("Кроны: запуск ср и сб, два захода сбора; роут отвечает на GET", () => {
  const vercel = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")) as { crons: Array<{ path: string; schedule: string }> };
  const crons = vercel.crons.filter((c) => c.path.startsWith("/api/sync/assortment-brightdata"));
  assert.deepEqual(crons.map((c) => c.schedule), ["0 5 * * 3,6", "30 6 * * 3,6", "30 8 * * 3,6"]);
  assert.match(readFileSync(join(root, "app/api/sync/assortment-brightdata/route.ts"), "utf8"), /export async function GET/);
});

test("Отзывы магазина попадают в «почему показали»", () => {
  const signal = cardSignal([{ group_kind: "retail", metric: "reviews_count", value_text: null, value_num: 152, null_reason: null, status: "observed", observed_at: "2026-10-07T07:00:00Z" }], { manual: false, colors: 0 });
  assert.match(signal.why, /отзывов на сайте магазина: 152/);
});

test("База — по разделу: известные сумки не делают куртки новинками", () => {
  const source = readFileSync(join(root, "lib/assortment/brightdataCrawl.ts"), "utf8");
  assert.match(source, /knownIds\(db, source\.sourceId, target\.direction\)/);
  assert.match(source, /\.eq\("direction", direction\)/);
});

test("Фото магазинов — в высоком разрешении, а не превью 44 px", async () => {
  const { hiResImageUrl } = await import("../lib/assortment/brightdataCatalog.ts");
  assert.equal(hiResImageUrl("https://images.asos-media.com/products/x/210187178-2?$n_240w$&wid=44&fit=constrain"), "https://images.asos-media.com/products/x/210187178-2?$n_1920w$&wid=1200&fit=constrain");
  assert.equal(hiResImageUrl("https://images.asos-media.com/products/x/210187178-1-beige"), "https://images.asos-media.com/products/x/210187178-1-beige?$n_1920w$&wid=1200&fit=constrain");
  assert.match(hiResImageUrl("https://image.hm.com/assets/hm/1.jpg?imwidth=320"), /imwidth=1200/);
  assert.equal(hiResImageUrl("https://cdn.shopify.com/s/files/a.png?v=1"), "https://cdn.shopify.com/s/files/a.png?v=1");
  const record = mapRecord({ url: "https://www.asos.com/x/prd/1", name: "Trench jacket", image: "https://images.asos-media.com/products/x/1-1-beige", additional_image_urls: ["https://images.asos-media.com/products/x/1-2?$n_240w$&wid=44&fit=constrain"] })!;
  assert.ok(record.images.every((u) => u.includes("wid=1200")));
});

test("Повтор товара в выборке (Zara по странам) — одна запись, с фото", () => {
  const us = mapRecord({ product_id: 5070666, product_name: "BOMBER JACKET", url: "https://www.zara.com/us/en/bomber-jacket-p05070666.html" })!;
  const uk = mapRecord({ product_id: 5070666, product_name: "BOMBER JACKET", url: "https://www.zara.com/uk/en/bomber-jacket-p05070666.html", image: ["https://static.zara.net/a.jpg"] })!;
  const other = mapRecord({ product_id: 6318252, product_name: "LEATHER BOMBER", url: "https://www.zara.com/us/en/leather-bomber-p06318252.html" })!;
  const unique = uniqueRecords([us, uk, other, uk]);
  assert.equal(unique.length, 2);
  assert.deepEqual(unique.map((r) => r.sourceItemId), ["5070666", "6318252"]);
  assert.equal(unique[0].images.length, 1);
});

test("Uniqlo — готовый набор по средам: женская верхняя одежда без блейзеров, размер S; сумки", () => {
  const uniqlo = BRIGHTDATA_TARGETS.filter((t) => t.sourceId === "S003");
  assert.deepEqual(uniqlo.filter((t) => !t.part).map((t) => t.direction).sort(), ["bags", "jackets"]);
  assert.ok(uniqlo.every((t) => t.kind === "dataset" && t.weekdayUtc === 3 && t.datasetId === "gd_mosh3s7wdb7jafn85"));
  const jackets = JSON.stringify(uniqlo.find((t) => t.direction === "jackets" && !t.part)!.filter);
  assert.match(jackets, /WOMEN > Outerwear/);
  assert.match(jackets, /"not_includes","value":"Blazers"/);
  assert.match(jackets, /"-003"/);
  assert.match(jackets, /"ES"/);
  assert.match(JSON.stringify(uniqlo.find((t) => t.direction === "bags" && !t.part)!.filter), /WOMEN > Accessories > Bags/);
});

test("Запись набора Uniqlo: модель по group_id, раздел, отзывы, фото 1200 px", () => {
  const record = mapRecord(stripMoney({
    title: "PUFFERTECH Compact Jacket", item_id: "469862-69-003", group_id: "E469862-000", brand: "UNIQLO",
    product_category: "WOMEN > Outerwear > PUFFERTECH > PUFFERTECH Compact Jacket", url: "https://www.uniqlo.com/es/en/products/E469862-000/00",
    image_url: "https://image.uniqlo.com/UQ/ST3/eu/imagesgoods/469862/item/eugoods_09_469862_3x4.jpg", review_count: 652, star_rating: 4.7, final_price: 49.9,
  }))!;
  assert.equal(record.sourceItemId, "E469862-000");
  assert.equal(record.brand, "UNIQLO");
  assert.match(record.category, /WOMEN > Outerwear/);
  assert.equal(record.reviews, 652);
  assert.equal(record.images[0], "https://image.uniqlo.com/UQ/ST3/eu/imagesgoods/469862/item/eugoods_09_469862_3x4.jpg?width=1200");
  assert.doesNotMatch(JSON.stringify(record), /49\.9/);
});

test("Выборка набора: обрезанному разделу и смене фильтра новинки не верим", () => {
  const snapshot = { recordsLimit: 400, coverage: filterSignature({ a: 1 }), direction: "jackets" as const };
  const truncated = datasetVerdict(400, snapshot, snapshot.coverage);
  assert.equal(truncated.quiet, true);
  assert.equal(truncated.remember, false);
  assert.match(truncated.warning ?? "", /куртки.*больше потолка/);
  assert.deepEqual(datasetVerdict(180, snapshot, undefined), { quiet: true, remember: true, warning: null }, "охват ещё не запомнен — это база раздела");
  assert.deepEqual(datasetVerdict(180, snapshot, filterSignature({ a: 2 })), { quiet: true, remember: true, warning: null }, "фильтр сменился — база заново");
  assert.deepEqual(datasetVerdict(180, snapshot, snapshot.coverage), { quiet: false, remember: true, warning: null });
  assert.deepEqual(datasetVerdict(60, { direction: "bags" }, undefined), { quiet: false, remember: false, warning: null }, "старые пробы без потолка — как раньше");
});

test("Охват разделов хранится в capabilities рядом с пробами", () => {
  assert.equal(filterSignature({ a: [1, 2] }), filterSignature({ a: [1, 2] }));
  assert.notEqual(filterSignature({ a: [1, 2] }), filterSignature({ a: [1, 3] }));
  const key = coverageKey({ datasetId: "gd_x", direction: "bags" });
  const caps = writeCoverage(writePending({ note: "x" }, []), { [key]: "abc" });
  assert.equal(caps.note, "x");
  assert.deepEqual(readCoverage(caps), { [key]: "abc" });
  assert.deepEqual(readPending(caps), []);
  assert.deepEqual(readCoverage({ brightdata_coverage: { [key]: 5 } }), {});
});

test("Чужое семейство в наборе Zara (ремень, брюки под BOLSO) в сумки не идёт", () => {
  const zara = (name: string, family: string) => asCatalogItem(mapRecord({ product_id: 1, product_name: name, url: "https://www.zara.com/us/en/x-p01.html", product_family: family })!);
  assert.equal(classifyItem(zara("LEATHER DRESS BELT", "BOLSO"), ["bags"]), null);
  assert.equal(classifyItem(zara("PANTS WITH A HIGH WAIST", "BOLSO"), ["bags"]), null);
  assert.equal(classifyItem(zara("LEATHER CROSSBODY BAG", "BOLSO"), ["bags"]), "bags");
  assert.equal(classifyItem(zara("WOOL BLEND COAT WITH FAUX FUR COLLAR", "ABRIGO"), ["jackets"]), "jackets");
  assert.equal(classifyItem(zara("FAUX LEATHER BOMBER JACKET", "CAZADORA"), ["jackets"]), "jackets");
});

test("Пересборка набора: много «новых» разом — не новинки", () => {
  assert.equal(looksLikeChurn(4, 120), false, "4 из 120 — обычная неделя");
  assert.equal(looksLikeChurn(10, 20), false, "до десяти моделей верим");
  assert.equal(looksLikeChurn(40, 120), true);
  assert.equal(looksLikeChurn(12, 30), true);
});

test("Застрявшие новинки (сверх 15 за прогон, сбой записи) не теряются: идут первыми, от старых к новым", () => {
  const now = Date.parse("2026-11-10T00:00:00Z");
  const orphans = new Map([["b", "2026-11-08T00:00:00Z"], ["a", "2026-11-03T00:00:00Z"], ["old", "2026-09-20T00:00:00Z"], ["gone", "2026-11-05T00:00:00Z"]]);
  const r = novelCandidates(["x", "b", "a", "old", "y"], new Set(["x", "y"]), orphans, now, false);
  assert.deepEqual(r.create, ["a", "b", "x", "y"], "сироты от старых к новым, потом свежие; ушедшая с сайта сирота («gone») не в этом сборе");
  assert.deepEqual(r.expire, ["old"], "старше 30 дней — в базу, в каталог");
  const quiet = novelCandidates(["x", "b", "a"], new Set(["x"]), orphans, now, true);
  assert.deepEqual(quiet.create, ["a", "b"], "сбор лёг базой (обрезан, пересборка) — свежим не верим, а сиротам — да: их новизну подтвердил прошлый сбор");
  assert.deepEqual(novelCandidates([], new Set(), new Map(), now, false), { create: [], expire: [] });
  const legacy = novelCandidates(["z"], new Set(), new Map([["z", "2026-10-03T21:00:00Z"]]), Date.parse("2026-10-07T00:00:00Z"), false);
  assert.deepEqual(legacy, { create: [], expire: ["z"] }, "хвосты старых ошибок (до 04.10) — в базу, не в ленту");
});

test("Сироты разбираются только у полных разделов; дата находки — сегодня, исходная — в наблюдении", () => {
  const source = readFileSync(join(root, "lib/assortment/brightdataCrawl.ts"), "utf8");
  assert.match(source, /row\.baseline === false && !row\.reference_id/);
  assert.match(source, /firstSeenAt: orphans\.get\(id\)/);
  assert.doesNotMatch(source, /first_seen_at: options\.firstSeenAt/, "дата находки — сегодняшняя: иначе мимо сводки и верха ленты");
  assert.match(source, /value_text: options\.firstSeenAt \?\? now/, "исходная дата — в наблюдении");
  assert.match(source, /drainOrphans: snapshot\.kind === "dataset"/, "ASOS и H&M (обрезанная выдача) хвост не разбирают");
  assert.match(source, /options\.cloudPhotos === false \? \[\] : record\.images/, "сайты через mini — облако фото не тянет");
  const ru = readFileSync(join(root, "lib/assortment/ruShopsStore.ts"), "utf8");
  assert.equal((ru.match(/cloudPhotos: shop\.via !== "mini", drainOrphans: true/g) ?? []).length, 2);
});

test("Мёртвые снимки Zara (`/photos///2023…`, 404) не сохраняются; живые `/assets/public/…` — да", () => {
  const record = mapRecord({
    product_id: 1, product_name: "PADDED BOMBER JACKET", url: "https://www.zara.com/us/en/padded-bomber-jacket-p00695071.html", product_family: "CAZADORA",
    image: ["https://static.zara.net/photos///2024/V/0/1/p/8073/205/800/12/w/1920/8073205800_1_1_1.jpg?ts=1", "https://static.zara.net/assets/public/7337/1758/0eec4845bc39/4d0836546ed2/00695071800-e1/00695071800-e1.jpg?ts=2&w=1920"],
  })!;
  assert.deepEqual(record.images, ["https://static.zara.net/assets/public/7337/1758/0eec4845bc39/4d0836546ed2/00695071800-e1/00695071800-e1.jpg?ts=2&w=1920"]);
  const source = readFileSync(join(root, "lib/assortment/brightdataCrawl.ts"), "utf8");
  assert.match(source, /imagesKnown: snapshot\.kind === "dataset"/, "у готовых наборов «фото нет» снимает старые мёртвые ссылки");
});

test("Фото Zara из «Zara.com products»: номер модели из адреса, витрина США, живые снимки, до 4 на модель", async () => {
  const { ZARA_PHOTOS, zaraModelCode, zaraPhotoFilter, zaraPhotosByCode, readPhotoPending, writePhotoPending } = await import("../lib/assortment/brightdataCatalog.ts");
  assert.equal(zaraModelCode("https://www.zara.com/us/en/cropped-suede-leather-jacket-p03833400.html"), "03833400");
  assert.equal(zaraModelCode("https://www.zara.com/us/en/woman-jackets-l1114.html"), null);
  const filter = JSON.stringify(zaraPhotoFilter(Array.from({ length: 500 }, (_, i) => String(i).padStart(8, "0"))));
  assert.match(filter, /"store_country","operator":"=","value":"US"/);
  assert.equal((filter.match(/"\d{8}"/g) ?? []).length, 400, "не больше 400 моделей за выборку");
  assert.ok(ZARA_PHOTOS.recordsLimit <= 1000, "потолок выборки фото");
  const photos = zaraPhotosByCode([
    { group_id: "03833400", image_url: "https://static.zara.net/assets/public/a/1.jpg?ts=1&w=1920", additional_image_urls: ["https://static.zara.net/assets/public/a/2.jpg", "https://static.zara.net/photos///2024/V/x.jpg"] },
    { group_id: "03833400", image_url: "https://static.zara.net/assets/public/a/3.jpg", additional_image_urls: ["https://static.zara.net/assets/public/a/4.jpg", "https://static.zara.net/assets/public/a/5.jpg"] },
    { group_id: 695071, image_url: "https://static.zara.net/assets/public/b/1.jpg" },
    { group_id: "00000001", image_url: "https://static.zara.net/photos///2023/I/dead.jpg" },
  ]);
  assert.deepEqual(photos.get("03833400"), ["https://static.zara.net/assets/public/a/1.jpg?ts=1&w=1920", "https://static.zara.net/assets/public/a/2.jpg", "https://static.zara.net/assets/public/a/3.jpg", "https://static.zara.net/assets/public/a/4.jpg"], "цвета модели сливаются, мёртвые отброшены, до 4");
  assert.deepEqual(photos.get("00695071"), ["https://static.zara.net/assets/public/b/1.jpg"], "числовой номер дополняется нулями до 8 цифр");
  assert.equal(photos.has("00000001"), false, "только мёртвые — модели нет");
  const caps = writePhotoPending({ note: "x", brightdata_pending: [] }, [{ snapshotId: "snap_x", triggeredAt: "2026-10-04T10:00:00Z" }]);
  assert.equal(caps.note, "x");
  assert.deepEqual(readPhotoPending(caps), [{ snapshotId: "snap_x", triggeredAt: "2026-10-04T10:00:00Z" }]);
});

test("Фото Zara заказываются сами после сбора Zara и вручную ?phase=photos; применяются ближайшим сбором", () => {
  const crawl = readFileSync(join(root, "lib/assortment/brightdataCrawl.ts"), "utf8");
  assert.match(crawl, /if \(!billingStop && \(result\.collected \?\? 0\) > 0 && photoLeft\.length === 0\)/, "после свежего сбора Zara (и не после «нет денег»)");
  assert.match(crawl, /r\.image_urls\.every\(\(u\) => typeof u !== "string" \|\| isDeadImageUrl\(u\)\)/, "мёртвые ссылки в базе — как «фото нет»");
  assert.match(crawl, /refs\.filter\(\(r\) => !withMedia\.has\(r\.id\)\)\.slice\(0, 20\)/, "потолок 20 — только по находкам без фото");
  assert.match(crawl, /imagesKnown: options\.imagesKnown && !livePhotos\.has\(r\.sourceItemId\)/, "еженедельный сбор не стирает живые фото из второго набора — не покупаем их заново");
  assert.match(crawl, /isMissingColumnError\(error instanceof Error \? error : new Error\(String\(error\)\)\)\) return \[\];\s*throw error;/, "сбой базы не глотается");
  assert.match(crawl, /photoLeft\.push\(pending\);/, "сбой применения — выборка остаётся в очереди");
  assert.match(crawl, /if \(waiting\.length === 0\) \{\s*const refusal = await photosRefusal\(db, engine, spent\);[\s\S]{0,300}const next = await triggerZaraPhotos/, "вручную — новую выборку только если до вызова ничего не ждало (повторный вызов не покупает ещё одну) и она помещается в потолок движка");
  const route = readFileSync(join(root, "app/api/sync/assortment-brightdata/route.ts"), "utf8");
  assert.match(route, /get\("phase"\) === "photos"/);
});

test("Выборка фото не зависает: пустая — применять нечего, не удавшаяся у Bright Data — снимается, состояние видно", () => {
  const crawl = readFileSync(join(root, "lib/assortment/brightdataCrawl.ts"), "utf8");
  assert.match(crawl, /if \(response\.status === 400 && \/empty\|no \(data\|records\)\/i\.test\(text\)\) return \[\];/);
  assert.match(crawl, /const keep = !isPermanentDownloadError\(e\) && fresh\(pending\);/, "ручной путь — то же правило «временное/окончательное», что и в плановом сборе");
  assert.match(crawl, /result\.detail\.push\(/, "в ответе ручного запуска — номер выборки и её состояние");
});

test("Мёртвые ссылки Zara снимаются сразу при работе с фото, без платной выборки", () => {
  const crawl = readFileSync(join(root, "lib/assortment/brightdataCrawl.ts"), "utf8");
  assert.match(crawl, /export async function clearDeadZaraPhotos/);
  assert.match(crawl, /r\.image_urls\.every\(\(u\) => typeof u !== "string" \|\| isDeadImageUrl\(u\)\)\)\s*\.map\(\(r\) => \(\{ source_id: ZARA_PHOTOS\.sourceId, source_item_id: r\.source_item_id, image_urls: null \}\)\)/, "снимаем только строки, где живых нет");
  assert.match(crawl, /const cleared = await clearDeadZaraPhotos\(db\);/, "ручной запуск");
  assert.match(crawl, /await clearDeadZaraPhotos\(db\)\.catch/, "плановый сбор");
});

// --- поведение: платная выборка не теряется, запуск не покупает дважды (аудит 05.10) ---

type Caps = Record<string, unknown>;
/**
 * Паспорт источников: у каждого свои capabilities; учёт расхода движка (assortment_ai_usage) — строки `usage` с фильтрами eq; чужие таблицы
 * (строки каталога) пусты.
 */
function sourcesDb(initial: Record<string, Caps>, failUpdate?: (patch: Record<string, unknown>) => boolean, usage: Array<Record<string, unknown>> = []) {
  const state = { caps: { ...initial } as Record<string, Caps>, patches: [] as Array<{ id: string; patch: Record<string, unknown> }>, usage: usage.map((u) => ({ ...u })) };
  const db = {
    from: (table: string) => {
      let patch: Record<string, unknown> | null = null;
      let id = "";
      const isUsage = table === "assortment_ai_usage";
      const eqs: Array<[string, unknown]> = [];
      const usageRows = () => state.usage.filter((r) => eqs.every(([c, v]) => r[c] === v));
      const q: Record<string, unknown> = {
        select: () => q,
        update: (p: Record<string, unknown>) => { patch = p; return q; },
        eq: (c: string, v: string) => { eqs.push([c, v]); if (!isUsage) id = v; return q; },
        not: () => q, gte: () => q, order: () => q, limit: () => q,
        range: () => Promise.resolve({ data: [], error: null }),
        insert: (row: Record<string, unknown>) => { if (isUsage) state.usage.push({ ...row }); return Promise.resolve({ error: null }); },
        maybeSingle: () => Promise.resolve(isUsage
          ? { data: usageRows()[0] ?? null, error: null }
          : { data: { source_id: id, name: id === "S001" ? "Zara" : id, capabilities: state.caps[id] ?? {} }, error: null }),
        then: (resolve: (v: unknown) => unknown) => {
          if (isUsage) {
            const hit = usageRows();
            if (patch) for (const r of hit) Object.assign(r, patch);
            return Promise.resolve({ data: patch ? hit.map((r) => ({ day: r.day })) : hit, error: null }).then(resolve);
          }
          // сбой записи в базу: патч не применяется
          if (table === "assortment_sources" && patch && failUpdate?.(patch)) return Promise.resolve({ data: null, error: { message: "db write failed" } }).then(resolve);
          if (table === "assortment_sources" && patch) {
            // Как настоящая база: записывается снимок, а не живая ссылка на массив, который код потом продолжает менять.
            state.patches.push({ id, patch: JSON.parse(JSON.stringify(patch)) });
            if ("capabilities" in patch) state.caps[id] = JSON.parse(JSON.stringify(patch.capabilities)) as Caps;
          }
          return Promise.resolve({ data: [], error: null }).then(resolve);
        },
      };
      return q;
    },
  };
  return { db: db as never, state };
}

async function withFetch<T>(handler: (url: string, init?: RequestInit) => Response | Promise<Response>, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  const token = process.env.BRIGHTDATA_API_TOKEN;
  process.env.BRIGHTDATA_API_TOKEN = "test-token";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init)) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
    if (token === undefined) delete process.env.BRIGHTDATA_API_TOKEN;
    else process.env.BRIGHTDATA_API_TOKEN = token;
  }
}

const pendingFor = (snapshotId: string, triggeredAt: string) => ({ snapshotId, datasetId: "gd_zara", direction: "jackets", method: "brightdata_zara", triggeredAt, kind: "dataset", recordsLimit: 600 });

test("Оплаченная выборка набора не пропадает на временном сбое скачивания (таймаут, 429, 5xx) — остаётся в очереди; окончательный отказ (404) снимает её", async () => {
  const fresh = new Date(Date.now() - 3600 * 1000).toISOString();
  for (const [status, kept] of [[500, true], [429, true], [503, true], [404, false], [403, false]] as const) {
    const { db, state } = sourcesDb({ S001: { brightdata_pending: [pendingFor("snap_abc", fresh)] } });
    const results = await withFetch(() => new Response("boom", { status }), () => collectBrightData(db, Date.now() + 60_000));
    const zara = results.find((r) => r.sourceId === "S001")!;
    assert.equal(zara.ok, false, `HTTP ${status}: сбой назван`);
    assert.match(zara.error ?? "", new RegExp(`HTTP ${status}`));
    const left = (state.caps.S001.brightdata_pending as unknown[]) ?? [];
    assert.equal(left.length, kept ? 1 : 0, `HTTP ${status}: ${kept ? "проба осталась" : "проба снята"}`);
    const last = state.patches.filter((p) => p.id === "S001").pop()!;
    assert.match(String(last.patch.last_error), /Bright Data:/, "причина видна в «Источниках»");
  }
  // Сбой связи (исключение fetch) — тоже временный.
  const { db, state } = sourcesDb({ S001: { brightdata_pending: [pendingFor("snap_net", fresh)] } });
  await withFetch(() => { throw new TypeError("fetch failed"); }, () => collectBrightData(db, Date.now() + 60_000));
  assert.equal(((state.caps.S001.brightdata_pending as unknown[]) ?? []).length, 1, "обрыв связи — проба остаётся");
  // Старше суток и не скачалась — снимается (иначе висела бы вечно).
  const old = new Date(Date.now() - 30 * 3600 * 1000).toISOString();
  const stale = sourcesDb({ S001: { brightdata_pending: [pendingFor("snap_old", old)] } });
  await withFetch(() => new Response("boom", { status: 500 }), () => collectBrightData(stale.db, Date.now() + 60_000));
  assert.equal(((stale.state.caps.S001.brightdata_pending as unknown[]) ?? []).length, 0);
});

test("Платный запуск идемпотентен: пока по цели ждёт проба, повторный вызов (повторная доставка крона) новую не заказывает; force=1 — заказывает", async () => {
  let paid = 0;
  const handler = (url: string) => {
    if (url.includes("/datasets/v3/trigger")) {
      paid += 1;
      return new Response(JSON.stringify({ snapshot_id: `s_${paid}` }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  };
  const { db, state } = sourcesDb({});
  const first = await withFetch(handler, () => triggerBrightData(db, { only: "S046" }));
  assert.ok(first.every((r) => r.ok), JSON.stringify(first));
  const orderedFirst = paid;
  assert.equal(orderedFirst, 4, "ASOS: у каждого раздела по две цели с разными входами — все четыре заказаны (одинаковый набор и раздел цели не схлопывают)");
  assert.equal(((state.caps.S046.brightdata_pending as unknown[]) ?? []).length, orderedFirst);
  const second = await withFetch(handler, () => triggerBrightData(db, { only: "S046" }));
  assert.equal(paid, orderedFirst, "повторный вызов ничего не заказал");
  assert.ok(second.length === 0 || second.every((r) => (r.triggered ?? 0) === 0));
  await withFetch(handler, () => triggerBrightData(db, { only: "S046", force: true }));
  assert.equal(paid, orderedFirst * 2, "осознанный повтор force=1 — заказывает снова");
});

test("Сбой N-й платной цели не теряет уже оплаченные пробы: они записаны сразу, повторный запуск покупает только недостающие", async () => {
  let issued = 0;
  let failOn = 3;
  let attempts = 0;
  let seenAtFailure: string[] | null = null;
  const handler = (url: string) => {
    if (!url.includes("/datasets/v3/trigger")) return new Response("{}", { status: 200 });
    attempts += 1;
    if (attempts === failOn) {
      // Что лежит в базе в момент сбоя третьей цели, ещё до обработчика сбоя (так выглядит и убитая по таймауту функция): проба каждой оплаченной цели уже записана.
      seenAtFailure = pendingIds(state);
      return new Response("rate limited", { status: 429 });
    }
    issued += 1;
    return new Response(JSON.stringify({ snapshot_id: `s_${issued}` }), { status: 200 });
  };
  const pendingIds = (st: { caps: Record<string, Caps> }) => ((st.caps.S046?.brightdata_pending as Array<{ snapshotId: string }>) ?? []).map((p) => p.snapshotId);
  const { db, state } = sourcesDb({});
  const first = await withFetch(handler, () => triggerBrightData(db, { only: "S046" }));
  assert.equal(first[0].ok, false);
  assert.match(first[0].error ?? "", /429/);
  assert.equal(first[0].triggered, 2, "в итоге названо, сколько проб оплачено до сбоя");
  assert.deepEqual(seenAtFailure, ["s_1", "s_2"], "к моменту сбоя третьей цели две оплаченные пробы уже записаны, а не ждут конца цикла");
  assert.deepEqual(pendingIds(state), ["s_1", "s_2"], "две оплаченные пробы сохранены, хотя третья цель упала");
  const last = state.patches.filter((p) => p.id === "S046").pop()!;
  assert.match(String(last.patch.last_error), /429.*оплачено и сохранено проб: 2/, "причина и число сохранённых проб видны в «Источниках»");
  // Повторный запуск (ручной, без force): ASOS — четыре цели, две уже ждут — покупаются только две недостающие.
  failOn = 0;
  const second = await withFetch(handler, () => triggerBrightData(db, { only: "S046" }));
  assert.ok(second.every((r) => r.ok), JSON.stringify(second));
  assert.equal(issued, 4, "всего куплено четыре пробы, а не шесть: s_1 и s_2 не покупались повторно");
  assert.deepEqual(pendingIds(state), ["s_1", "s_2", "s_3", "s_4"]);
  assert.equal(second[0].triggered, 2);
});

test("Сбой записи очереди после оплаты: покупка останавливается, а оплаченные пробы всё равно сохраняются повторной попыткой в обработчике сбоя", async () => {
  let issued = 0;
  const handler = (url: string) => {
    if (!url.includes("/datasets/v3/trigger")) return new Response("{}", { status: 200 });
    issued += 1;
    return new Response(JSON.stringify({ snapshot_id: `s_${issued}` }), { status: 200 });
  };
  // запись очереди из двух проб падает один раз
  let failed = false;
  const { db, state } = sourcesDb({}, (patch) => {
    const pending = (patch.capabilities as { brightdata_pending?: unknown[] } | undefined)?.brightdata_pending;
    if (!failed && pending?.length === 2) { failed = true; return true; }
    return false;
  });
  const result = await withFetch(handler, () => triggerBrightData(db, { only: "S046" }));
  assert.equal(result[0].ok, false);
  assert.match(result[0].error ?? "", /db write failed/);
  assert.equal(issued, 2, "после сбоя записи третью и четвёртую пробы не покупаем вслепую");
  assert.deepEqual(((state.caps.S046?.brightdata_pending as Array<{ snapshotId: string }>) ?? []).map((p) => p.snapshotId), ["s_1", "s_2"], "обе оплаченные пробы сохранены повторной попыткой");
});

test("Ручной ?phase=photos: 429 и 408 — временные (оплаченная выборка остаётся в очереди, как и в плановом сборе), 500 тоже; 404 — снимает; старше суток — снимает", async () => {
  const fresh = new Date(Date.now() - 3600 * 1000).toISOString();
  const old = new Date(Date.now() - 30 * 3600 * 1000).toISOString();
  const photoPending = (triggeredAt: string) => ({ snapshotId: "snap_paid", triggeredAt });
  const left = (state: { caps: Record<string, Caps> }) => ((state.caps.S001.brightdata_photo_pending as unknown[]) ?? []).length;
  for (const [status, kept] of [[429, true], [408, true], [500, true], [503, true], [404, false], [403, false]] as const) {
    const { db, state } = sourcesDb({ S001: { brightdata_photo_pending: [photoPending(fresh)] } });
    const result = await withFetch(() => new Response("boom", { status }), () => requestZaraPhotos(db, Date.now() + 60_000));
    assert.equal(left(state), kept ? 1 : 0, `ручной запуск, HTTP ${status}: ${kept ? "выборка осталась" : "выборка снята"}`);
    assert.equal(result.triggered, 0, "новую выборку не покупаем, пока старая в очереди");
    assert.match((result.detail ?? []).join(" "), kept ? /ждём/ : /снята/);
    // тот же ответ в плановом сборе даёт то же решение
    const planned = sourcesDb({ S001: { brightdata_photo_pending: [photoPending(fresh)] } });
    await withFetch(() => new Response("boom", { status }), () => collectBrightData(planned.db, Date.now() + 60_000));
    assert.equal(left(planned.state), left(state), `HTTP ${status}: плановый и ручной путь решают одинаково`);
  }
  // Временный сбой, но выборке больше суток — снимается и в сообщении так и сказано.
  const stale = sourcesDb({ S001: { brightdata_photo_pending: [photoPending(old)] } });
  const staleResult = await withFetch(() => new Response("slow down", { status: 429 }), () => requestZaraPhotos(stale.db, Date.now() + 60_000));
  assert.equal(left(stale.state), 0);
  assert.match((staleResult.detail ?? []).join(" "), /снята/);
});

test("Мёртвые фото Zara снимаются у ВСЕХ строк окна, а не у первой тысячи по id (дальше неё модели оставались «с фото» и показывали заглушку)", async () => {
  const rows = Array.from({ length: 1500 }, (_, i) => ({
    source_item_id: `item${String(i).padStart(5, "0")}`,
    // первая тысяча — живые фото, последние 500 — мёртвые снимки старого вида Zara
    image_urls: i < 1000 ? ["https://static.zara.net/assets/ok.jpg"] : ["https://static.zara.net/photos/dead.jpg"],
  }));
  const upserted: Array<Record<string, unknown>> = [];
  const db = {
    from: () => {
      const q: Record<string, unknown> = {
        select: () => q, eq: () => q, not: () => q, gte: () => q, order: () => q,
        range: (from: number, to: number) => Promise.resolve({ data: rows.slice(from, Math.min(to, from + 999) + 1), error: null }),
        upsert: (batch: Array<Record<string, unknown>>) => { upserted.push(...batch); return Promise.resolve({ error: null }); },
      };
      return q;
    },
  } as never;
  const cleared = await clearDeadZaraPhotos(db);
  assert.equal(cleared, 500);
  assert.equal(upserted.length, 500);
  assert.ok(upserted.every((r) => r.image_urls === null && String(r.source_item_id) >= "item01000"), "сняты именно мёртвые, из хвоста за тысячу");
});

// --- части разделов: CHAQUETA Zara и коллаборации Uniqlo (решение владельца 06.10, только женское) ---

const ZARA_DS = "gd_lct4vafw1tgx27d4o0";
const UNIQLO_DS = "gd_mosh3s7wdb7jafn85";
const zaraChaqueta = (name: string, extra: Record<string, unknown> = {}) => ({
  product_id: 5854722, product_name: name, url: "https://www.zara.com/us/en/high-neck-pocket-jacket-p05854722.html", product_family: "CHAQUETA", section: "WOMAN", ...extra,
});
const uniqloCollab = (title: string, category = `WOMEN > Special Collaborations > Uniqlo U > ${title}`, id = "E487882-000") => ({
  title, item_id: `${id.slice(1, 7)}-32-003`, group_id: id, product_category: category, url: `https://www.uniqlo.com/es/en/products/${id}/00`,
});

test("Основные выборки Zara и Uniqlo не тронуты: охват и ключ покупки прежние — сбор не ляжет базой, купленное не купится второй раз", () => {
  const main = BRIGHTDATA_TARGETS.filter((t) => t.kind === "dataset" && !t.part);
  assert.deepEqual(
    main.map((t) => `${t.sourceId}|${t.direction}|${filterSignature(t.filter)}|${t.recordsLimit}`),
    ["S001|jackets|15pwzo7|1000", "S001|bags|1yjhz2m|300", "S003|jackets|nz2k28|400", "S003|bags|b9ii13|300"],
    "фильтр основной выборки сменился — первый сбор по нему ляжет базой, «появилось» по разделу сдвинется на неделю",
  );
  assert.deepEqual(main.map((t) => purchaseKey({ ...t, targetKey: targetSignature(t) })), [`${ZARA_DS}|jackets`, `${ZARA_DS}|bags`, `${UNIQLO_DS}|jackets`, `${UNIQLO_DS}|bags`]);
  const parts = BRIGHTDATA_TARGETS.filter((t) => t.part);
  const keys = BRIGHTDATA_TARGETS.filter((t) => t.kind === "dataset").map(coverageKey);
  assert.equal(new Set(keys).size, keys.length, "у каждой выборки набора свой охват: часть не делит его с основной (иначе охват прыгал бы каждую неделю и новинок не было бы никогда)");
  assert.deepEqual(parts.map(coverageKey), [`${ZARA_DS}|jackets|zara_chaqueta`, `${UNIQLO_DS}|jackets|uniqlo_collab`, `${UNIQLO_DS}|bags|uniqlo_collab`]);
  for (const part of parts) {
    const index = BRIGHTDATA_TARGETS.indexOf(part);
    assert.ok(BRIGHTDATA_TARGETS.findIndex((t) => t.sourceId === part.sourceId && !t.part) < index && BRIGHTDATA_TARGETS.findLastIndex((t) => t.sourceId === part.sourceId && !t.part) < index, `${part.part}: после основных целей источника — сбой новой цели не мешает купить основные`);
    assert.ok(part.kind === "dataset" && part.weekdayUtc === 3 && (part.recordsLimit ?? 0) > 0 && (part.recordsLimit ?? 0) <= 1000, `${part.part}: раз в неделю, свой потолок`);
  }
});

test("Zara CHAQUETA — отдельной частью: женское, витрина США, в продаже, трикотаж и блейзеры отсечены уже в фильтре (не платим за кардиганы)", () => {
  const part = BRIGHTDATA_TARGETS.find((t) => t.part === "zara_chaqueta")!;
  assert.equal(part.sourceId, "S001");
  assert.equal(part.direction, "jackets");
  assert.equal(part.recordsLimit, 600);
  const filter = part.filter as { operator: string; filters: Array<{ name: string; operator: string; value: unknown }> };
  assert.equal(filter.operator, "and");
  const by = (name: string, operator: string) => filter.filters.find((f) => f.name === name && f.operator === operator)?.value;
  assert.equal(by("section", "="), "WOMAN", "только женское");
  assert.deepEqual(by("product_family", "in"), ["CHAQUETA"]);
  assert.equal(by("url", "includes"), "/us/en/");
  assert.equal(by("availability", "="), true);
  const notInName = by("product_name", "not_includes") as string[];
  for (const word of ["KNIT", "CARDIGAN", "PUNTO", "TRICOT", "JERSEY", "BLAZER"]) assert.ok(notInName.includes(word), `в фильтре нет «${word}»`);
  const full = datasetVerdict(600, { recordsLimit: 600, coverage: "x", direction: "jackets", part: "zara_chaqueta" }, "x");
  assert.equal(full.quiet, true);
  assert.match(full.warning ?? "", /раздел «куртки» \(часть: Zara CHAQUETA без трикотажа\) больше потолка выборки \(600\)/, "в «Источниках» видно, какая выборка упёрлась в потолок");
});

test("Правило части Zara CHAQUETA: куртка взята, кардиган и вязаный жакет — нет (по названию, описанию, по-испански), мужское — нет", () => {
  const keep = (raw: Record<string, unknown>) => keepPartRecord("zara_chaqueta", "jackets", raw);
  const jacket = zaraChaqueta("HIGH-NECK POCKET JACKET", { description: "Jacket with a high neck and long sleeves. Front pockets. Front zip closure." });
  assert.equal(keep(jacket), true, "5854/722 из рилса — куртка CHAQUETA");
  assert.equal(classifyItem(asCatalogItem(mapRecord(jacket)!), ["jackets"]), "jackets", "и в раздел курток её пускает разбор названия");
  assert.equal(keep(zaraChaqueta("BOMBER JACKET", { description: "Bomber jacket with a round neck. Rib knit trims. Front zip closure." })), true, "«rib knit trims» у бомбера — не трикотаж");
  assert.equal(keep(zaraChaqueta("CROPPED KNIT JACKET")), false, "вязаный жакет: главное слово «jacket», но это трикотаж");
  assert.equal(keep(zaraChaqueta("KNIT CARDIGAN WITH BUTTONS")), false);
  assert.equal(keep(zaraChaqueta("SOFT CÁRDIGAN")), false);
  assert.equal(keep(zaraChaqueta("TEXTURED JACKET", { description: "Knit jacket with a lapel collar and long sleeves." })), false, "трикотаж виден только в описании");
  assert.equal(keep(zaraChaqueta("CHAQUETA PUNTO CUELLO SUBIDO")), false, "испанское название");
  assert.equal(keep(zaraChaqueta("CHAQUETA CUELLO SUBIDO BOLSILLOS")), true, "испанское название куртки");
  assert.equal(keep(zaraChaqueta("SHORT JACKET", { product_subfamily: "CHAQUETA PUNTO" })), false, "подсемейство «punto», если набор его отдаёт");
  assert.equal(keep(zaraChaqueta("TWEED BLAZER")), false, "блейзер — не верхняя одежда");
  assert.equal(keep(zaraChaqueta("HIGH-NECK POCKET JACKET", { section: "MAN" })), false, "мужское не берём");
  assert.equal(keep(zaraChaqueta("HIGH-NECK POCKET JACKET", { section: "KID" })), false);
  assert.equal(keep(zaraChaqueta("HIGH-NECK POCKET JACKET", { section: undefined })), true, "раздела в записи нет — решает фильтр набора");
});

test("Uniqlo: коллаборации — отдельной частью: «WOMEN > Special Collaborations», куртки по названию, размер S, без блейзеров и трикотажа; сумки — по названию", () => {
  const jackets = BRIGHTDATA_TARGETS.find((t) => t.part === "uniqlo_collab" && t.direction === "jackets")!;
  const bags = BRIGHTDATA_TARGETS.find((t) => t.part === "uniqlo_collab" && t.direction === "bags")!;
  assert.equal(jackets.sourceId, "S003");
  assert.equal(bags.sourceId, "S003");
  const filters = (t: typeof jackets) => (t.filter as { operator: string; filters: Array<{ name: string; operator: string; value: unknown }> });
  const by = (t: typeof jackets, name: string, operator: string) => filters(t).filters.filter((f) => f.name === name && f.operator === operator).map((f) => f.value);
  for (const t of [jackets, bags]) {
    assert.equal(filters(t).operator, "and");
    assert.deepEqual(by(t, "store_country", "="), ["ES"]);
    assert.deepEqual(by(t, "product_category", "includes"), ["WOMEN > Special Collaborations"], "только женское: «MEN > …» строку «WOMEN > » не содержит");
  }
  assert.deepEqual(by(jackets, "item_id", "includes"), ["-003"], "размер S, как в основной выборке");
  assert.deepEqual(by(jackets, "product_category", "not_includes"), ["Blazers"]);
  const outer = by(jackets, "title", "includes")[0] as string[];
  for (const word of ["Jacket", "jacket", "Coat", "Parka", "Blouson", "Down", "Puffer", "Gilet", "Vest", "Harrington", "Trench"]) assert.ok(outer.includes(word), `куртки: нет «${word}»`);
  for (const word of ["Pants", "Trousers", "Shirt", "T-Shirt", "Skirt", "Dress"]) assert.ok(!outer.includes(word), `куртки: «${word}» не верхняя одежда`);
  assert.ok((by(jackets, "title", "not_includes")[0] as string[]).includes("Knit"));
  assert.ok((by(bags, "title", "includes")[0] as string[]).includes("Bag"));
  assert.deepEqual(by(bags, "item_id", "includes"), [], "у сумок размер один — фильтра размера нет");
  assert.ok((jackets.recordsLimit ?? 0) <= 200 && (bags.recordsLimit ?? 0) <= 100);
});

test("Правило части коллабораций Uniqlo: Uniqlo U Hybrid Down Short Jacket взята, брюки, трикотаж, блейзер и мужское — нет", () => {
  const keep = (raw: Record<string, unknown>, direction: "jackets" | "bags" = "jackets") => keepPartRecord("uniqlo_collab", direction, raw);
  const down = uniqloCollab("Hybrid Down Short Jacket");
  assert.equal(keep(down), true, "487882 из рилса");
  assert.equal(classifyItem(asCatalogItem(mapRecord(down)!), ["jackets"]), "jackets");
  assert.equal(keep(uniqloCollab("Blouson", "WOMEN > Special Collaborations > JW Anderson > Blouson")), true);
  assert.equal(classifyItem(asCatalogItem(mapRecord(uniqloCollab("Blouson", "WOMEN > Special Collaborations > JW Anderson > Blouson"))!), ["jackets"]), "jackets", "блузон — куртка, а не «не понять»");
  assert.equal(classifyItem(asCatalogItem(mapRecord(uniqloCollab("Harrington"))!), ["jackets"]), "jackets");
  assert.equal(classifyItem(asCatalogItem(mapRecord(uniqloCollab("Blouson Sleeve Top"))!), ["jackets"]), null, "«блузон-рукав» у топа — топ");
  assert.equal(keep(uniqloCollab("Tailored Coat", "WOMEN > Special Collaborations > UNIQLO : C > Tailored Coat")), true, "пальто — верхняя одежда");
  assert.equal(keep(uniqloCollab("Light Down Vest")), true);
  assert.equal(keep(uniqloCollab("Wide Straight Pants")), false, "брюки коллаборации");
  assert.equal(keep(uniqloCollab("Down Pants")), false, "«down» в названии брюк — всё равно брюки");
  assert.equal(keep(uniqloCollab("Oxford Button-Down Shirt")), false);
  assert.equal(keep(uniqloCollab("Crew Neck T-Shirt")), false);
  assert.equal(keep(uniqloCollab("Long-Sleeve Polo")), false, "нет слова верхней одежды — не берём, даже если главное слово не распознано");
  assert.equal(keep(uniqloCollab("3D Knit Vest")), false, "вязаный жилет — трикотаж");
  assert.equal(keep(uniqloCollab("Sweater Vest")), false);
  assert.equal(keep(uniqloCollab("Tailored Jacket")), false, "блейзер — не верхняя одежда");
  assert.equal(keep(uniqloCollab("Hybrid Down Short Jacket", "MEN > Special Collaborations > Uniqlo U > Hybrid Down Short Jacket")), false, "мужское не берём");
  assert.equal(keep(uniqloCollab("Round Mini Shoulder Bag", "WOMEN > Special Collaborations > Uniqlo U > Round Mini Shoulder Bag"), "bags"), true);
  assert.equal(keep(uniqloCollab("Round Mini Shoulder Bag", "MEN > Special Collaborations > Uniqlo U > Round Mini Shoulder Bag"), "bags"), false, "мужское не берём и в сумках");
  assert.deepEqual(partRecords({ direction: "jackets" }, [uniqloCollab("Wide Straight Pants")]).length, 1, "основная выборка правилом части не режется");
  assert.deepEqual(partRecords({ direction: "jackets", part: "toString" as never }, [uniqloCollab("Wide Straight Pants")]).length, 1, "незнакомая часть (откат версии) — записи как есть");
});

type Row = Record<string, unknown>;
/**
 * Таблицы в памяти для сбора готовой выборки: фильтры eq / not is null / gte / in, порядок и окно range применяются как в PostgREST,
 * upsert — по (source_id, source_item_id). Так видно, что именно легло в каталог.
 */
function catalogMemoryDb(sources: Record<string, Caps>) {
  const tables: Record<string, Row[]> = {
    assortment_sources: Object.entries(sources).map(([source_id, capabilities]) => ({ source_id, name: source_id === "S001" ? "Zara" : source_id === "S003" ? "Uniqlo" : source_id, capabilities })),
  };
  const builder = (name: string) => {
    const state: { op: "select" | "update" | "insert" | "upsert"; payload?: unknown; filters: Array<(row: Row) => boolean>; order?: string; from?: number; to?: number } = { op: "select", filters: [] };
    const rows = () => (tables[name] ??= []);
    const run = () => {
      if (state.op === "insert" || state.op === "upsert") {
        for (const item of (Array.isArray(state.payload) ? state.payload : [state.payload]) as Row[]) {
          const same = name === "assortment_source_items" ? rows().find((r) => r.source_id === item.source_id && r.source_item_id === item.source_item_id) : undefined;
          if (same) Object.assign(same, item);
          else rows().push({ ...item });
        }
        return { data: [], error: null };
      }
      const matched = rows().filter((row) => state.filters.every((f) => f(row)));
      if (state.op === "update") {
        for (const row of matched) Object.assign(row, JSON.parse(JSON.stringify(state.payload)));
        return { data: [], error: null };
      }
      const sorted = state.order ? matched.slice().sort((a, b) => String(a[state.order!]).localeCompare(String(b[state.order!]))) : matched;
      return { data: sorted.slice(state.from ?? 0, state.to === undefined ? undefined : state.to + 1).map((r) => ({ ...r })), error: null };
    };
    const api: Record<string, unknown> = {
      select: () => api,
      insert: (payload: unknown) => { state.op = "insert"; state.payload = payload; return Promise.resolve(run()); },
      upsert: (payload: unknown) => { state.op = "upsert"; state.payload = payload; return Promise.resolve(run()); },
      update: (payload: unknown) => { state.op = "update"; state.payload = payload; return api; },
      eq: (column: string, value: unknown) => { state.filters.push((r) => r[column] === value); return api; },
      in: (column: string, values: unknown[]) => { state.filters.push((r) => values.includes(r[column])); return api; },
      not: (column: string, op: string, value: unknown) => { assert.equal(`${op} ${value}`, "is null"); state.filters.push((r) => r[column] !== null && r[column] !== undefined); return api; },
      gte: (column: string, value: string) => { state.filters.push((r) => typeof r[column] === "string" && (r[column] as string) >= value); return api; },
      order: (column: string) => { state.order = column; return api; },
      range: (from: number, to: number) => { state.from = from; state.to = to; return Promise.resolve(run()); },
      maybeSingle: () => { const { data, error } = run(); return Promise.resolve({ data: data[0] ?? null, error }); },
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
    };
    return api;
  };
  const caps = (id: string) => tables.assortment_sources.find((r) => r.source_id === id)!.capabilities as Caps;
  return { db: { from: builder } as never, tables, caps };
}

test("Сбор части раздела: в каталог идут только записи, прошедшие правило части; охват — свой, основной раздел не трогается; прогон — окно", async () => {
  const fresh = new Date(Date.now() - 3600 * 1000).toISOString();
  const chaqueta = BRIGHTDATA_TARGETS.find((t) => t.part === "zara_chaqueta")!;
  const mainCoverage = filterSignature(BRIGHTDATA_TARGETS.find((t) => t.sourceId === "S001" && t.direction === "jackets" && !t.part)!.filter);
  const snapshot = {
    snapshotId: "snap_chaq", datasetId: ZARA_DS, direction: "jackets", method: "brightdata_zara", triggeredAt: fresh, kind: "dataset", part: "zara_chaqueta",
    recordsLimit: chaqueta.recordsLimit, coverage: filterSignature(chaqueta.filter), targetKey: targetSignature(chaqueta),
  };
  const { db, tables, caps } = catalogMemoryDb({ S001: { brightdata_pending: [snapshot], brightdata_coverage: { [`${ZARA_DS}|jackets`]: mainCoverage } } });
  const records = [
    zaraChaqueta("HIGH-NECK POCKET JACKET"),
    zaraChaqueta("CROPPED KNIT JACKET", { product_id: 1111111, url: "https://www.zara.com/us/en/cropped-knit-jacket-p01111111.html" }),
    zaraChaqueta("TEXTURED JACKET", { product_id: 2222222, url: "https://www.zara.com/us/en/textured-jacket-p02222222.html", description: "Knit jacket with a lapel collar." }),
    zaraChaqueta("QUILTED JACKET", { product_id: 3333333, url: "https://www.zara.com/us/en/quilted-jacket-p03333333.html", section: "MAN" }),
  ];
  const results = await withFetch((url) => {
    if (url.includes("/datasets/snapshots/snap_chaq/download")) return new Response(JSON.stringify(records), { status: 200 });
    if (url.includes("/datasets/filter")) return new Response(JSON.stringify({ snapshot_id: "snap_photos" }), { status: 200 });
    return new Response("{}", { status: 200 });
  }, () => collectBrightData(db, Date.now() + 60_000));
  const zara = results.find((r) => r.sourceId === "S001")!;
  assert.equal(zara.ok, true, zara.error);
  const items = tables.assortment_source_items ?? [];
  assert.deepEqual(items.map((r) => r.source_item_id), ["5854722"], "в каталог легла только куртка: вязаные жакеты и мужская куртка отсечены");
  assert.equal(items[0].direction, "jackets");
  assert.equal(items[0].baseline, true, "первый сбор части — база: старые модели не выдаются за новинки");
  assert.deepEqual(readCoverage(caps("S001")), { [`${ZARA_DS}|jackets`]: mainCoverage, [`${ZARA_DS}|jackets|zara_chaqueta`]: filterSignature(chaqueta.filter) }, "охват части запомнен отдельно, основной раздел не тронут");
  const runs = tables.assortment_run ?? [];
  assert.equal(runs.length, 1);
  assert.equal(runs[0].coverage, "window", "часть раздела — окно: её отсутствие не значит, что вещь пропала из раздела");
  assert.equal(runs[0].seen, 1);
});

test("Сбор части коллабораций Uniqlo: пуховик Uniqlo U в каталоге, брюки и мужское — нет; и на второй неделе часть — окно, а не полный раздел", async () => {
  const fresh = new Date(Date.now() - 3600 * 1000).toISOString();
  const collab = BRIGHTDATA_TARGETS.find((t) => t.part === "uniqlo_collab" && t.direction === "jackets")!;
  const snapshot = { snapshotId: "snap_collab", datasetId: UNIQLO_DS, direction: "jackets", method: "brightdata_uniqlo", triggeredAt: fresh, kind: "dataset", part: "uniqlo_collab", recordsLimit: 200, coverage: filterSignature(collab.filter) };
  // Охват части уже запомнен (вторая неделя): сбору верим, но прогон части всё равно не «полный» — это не весь раздел курток.
  const { db, tables } = catalogMemoryDb({ S003: { brightdata_pending: [snapshot], brightdata_coverage: { [`${UNIQLO_DS}|jackets|uniqlo_collab`]: filterSignature(collab.filter) } } });
  const records = [
    uniqloCollab("Hybrid Down Short Jacket"),
    uniqloCollab("3D Knit Vest", undefined, "E470000-000"),
    uniqloCollab("Down Pants", undefined, "E470001-000"),
    uniqloCollab("Hybrid Down Short Jacket", "MEN > Special Collaborations > Uniqlo U > Hybrid Down Short Jacket", "E470002-000"),
  ];
  await withFetch((url) => url.includes("snap_collab") ? new Response(JSON.stringify(records), { status: 200 }) : new Response("{}", { status: 200 }), () => collectBrightData(db, Date.now() + 60_000));
  assert.deepEqual((tables.assortment_source_items ?? []).map((r) => r.source_item_id), ["E487882-000"]);
  assert.deepEqual((tables.assortment_run ?? []).map((r) => r.coverage), ["window"]);
});

test("Платный запуск: купленный сегодня раздел второй раз не покупается — ни после сбора выборки, ни при смене фильтра; новая часть покупается; force=1 — всё", async () => {
  const wednesday = new Date("2026-10-07T10:00:00Z");
  const hoursAgo = (h: number) => new Date(wednesday.getTime() - h * 3600 * 1000).toISOString();
  const filters: Array<{ filter: unknown }> = [];
  const handler = (url: string, init?: RequestInit) => {
    if (!url.includes("/datasets/filter")) return new Response("{}", { status: 200 });
    filters.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ snapshot_id: `snap_${filters.length}` }), { status: 200 });
  };
  // Утренний крон уже купил и сбор уже забрал куртки (очереди нет, есть отметка покупки 3 ч назад); сумки покупали неделю назад.
  const { db, state } = sourcesDb({ S001: { brightdata_bought: { [`${ZARA_DS}|jackets`]: hoursAgo(3), [`${ZARA_DS}|bags`]: hoursAgo(7 * 24), "gd_gone|bags": hoursAgo(8 * 24) } } });
  const first = await withFetch(handler, () => triggerBrightData(db, { only: "S001", now: wednesday }));
  assert.ok(first.every((r) => r.ok), JSON.stringify(first));
  assert.equal(filters.length, 2, "куплены сумки и новая часть CHAQUETA, а куртки, купленные утром, — нет");
  assert.match(JSON.stringify(filters.map((f) => f.filter)), /CHAQUETA/);
  const pending = readPending(state.caps.S001);
  assert.deepEqual(pending.map((p) => p.part ?? "-").sort(), ["-", "zara_chaqueta"]);
  const bought = readBought(state.caps.S001);
  assert.equal(bought[`${ZARA_DS}|jackets|zara_chaqueta`], wednesday.toISOString(), "покупка части отмечена");
  assert.equal(bought[`${ZARA_DS}|jackets`], hoursAgo(3), "утренняя отметка не стёрта");
  assert.equal(bought[`${ZARA_DS}|bags`], wednesday.toISOString());
  assert.equal(bought["gd_gone|bags"], undefined, "отметки старше суток не копятся");
  // Повтор в тот же день, когда выборки уже забраны (очередь пуста), — ничего не покупает.
  state.caps.S001 = writePending(state.caps.S001, []);
  await withFetch(handler, () => triggerBrightData(db, { only: "S001", now: new Date(wednesday.getTime() + 2 * 3600 * 1000) }));
  assert.equal(filters.length, 2, "повторный запуск после сбора — ничего не куплено");
  // Через неделю — снова по плану.
  await withFetch(handler, () => triggerBrightData(db, { only: "S001", now: new Date(wednesday.getTime() + 7 * 24 * 3600 * 1000) }));
  assert.equal(filters.length, 5, "следующая среда — все три цели");
  // force=1 — осознанный повтор.
  await withFetch(handler, () => triggerBrightData(db, { only: "S001", force: true, now: new Date(wednesday.getTime() + 7 * 24 * 3600 * 1000 + 60_000) }));
  assert.equal(filters.length, 8);
});

test("Смена фильтра раздела: пока ждёт выборка по старому фильтру, раздел в тот же день не покупается заново", async () => {
  const wednesday = new Date("2026-10-07T10:00:00Z");
  let bought = 0;
  const handler = (url: string) => {
    if (!url.includes("/datasets/filter")) return new Response("{}", { status: 200 });
    bought += 1;
    return new Response(JSON.stringify({ snapshot_id: `snap_${bought}` }), { status: 200 });
  };
  // Ждёт выборка курток, купленная по прежнему фильтру (другой отпечаток цели), отметки покупки нет (купил старый код).
  const oldFilter = { snapshotId: "snap_old", datasetId: ZARA_DS, direction: "jackets", method: "brightdata_zara", triggeredAt: new Date(wednesday.getTime() - 3600 * 1000).toISOString(), kind: "dataset", recordsLimit: 1000, coverage: "old", targetKey: "old-signature" };
  const { db, state } = sourcesDb({ S001: { brightdata_pending: [oldFilter] } });
  await withFetch(handler, () => triggerBrightData(db, { only: "S001", now: wednesday }));
  assert.equal(bought, 2, "сумки и часть CHAQUETA куплены, куртки по новому фильтру — нет: раздел уже куплен сегодня");
  assert.deepEqual(readPending(state.caps.S001).map((p) => p.snapshotId), ["snap_old", "snap_1", "snap_2"]);
});

test("Покупка не состоялась (окончательный отказ Bright Data) — отметка снимается, повторный запуск может заказать снова; временный сбой — отметка остаётся", async () => {
  const fresh = new Date(Date.now() - 3600 * 1000).toISOString();
  for (const [status, released] of [[404, true], [500, false]] as const) {
    const snapshot = { ...pendingFor("snap_x", fresh), datasetId: ZARA_DS };
    const { db, state } = sourcesDb({ S001: { brightdata_pending: [snapshot], brightdata_bought: { [`${ZARA_DS}|jackets`]: fresh, [`${ZARA_DS}|bags`]: fresh } } });
    await withFetch(() => new Response("boom", { status }), () => collectBrightData(db, Date.now() + 60_000));
    const bought = readBought(state.caps.S001);
    assert.equal(bought[`${ZARA_DS}|jackets`] === undefined, released, `HTTP ${status}: ${released ? "отметка снята" : "отметка на месте"}`);
    assert.equal(bought[`${ZARA_DS}|bags`], fresh, "отметки других разделов не трогаем");
  }
  // Сборщик (ASOS): проба не удалась у самого Bright Data — отметку этой цели снимаем, соседней цели того же раздела — нет.
  const asos = { snapshotId: "s_failed", datasetId: "gd_ldbg7we91cp53nr2z4", direction: "bags", method: "brightdata_asos", triggeredAt: fresh, targetKey: "hobo" };
  const { db, state } = sourcesDb({ S046: { brightdata_pending: [asos], brightdata_bought: { "gd_ldbg7we91cp53nr2z4|bags|hobo": fresh, "gd_ldbg7we91cp53nr2z4|bags|mango": fresh } } });
  await withFetch((url) => url.includes("/progress/s_failed") ? new Response(JSON.stringify({ status: "failed" }), { status: 200 }) : new Response("{}", { status: 200 }), () => collectBrightData(db, Date.now() + 60_000));
  assert.deepEqual(Object.keys(readBought(state.caps.S046)), ["gd_ldbg7we91cp53nr2z4|bags|mango"]);
});

// --- правки по ревью ветки частей разделов (06.10) ---

/** last_error последней записи источника в паспорт. */
const lastError = (state: { patches: Array<{ id: string; patch: Record<string, unknown> }> }, id: string) =>
  state.patches.filter((p) => p.id === id && "last_error" in p.patch).pop()?.patch.last_error;

test("Сбой запуска части (фильтр не принят) не пропадает из «Источников» после сбора; следующая цель покупается; запуск без сбоя снимает его", async () => {
  let rejectCollabJackets = true;
  const purchased: string[] = [];
  const handler = (url: string, init?: RequestInit) => {
    if (url.includes("/datasets/filter")) {
      const filter = JSON.stringify(JSON.parse(String(init?.body)).filter);
      if (rejectCollabJackets && filter.includes("Special Collaborations") && filter.includes('"-003"')) return new Response('{"error":"filter: value must be a string"}', { status: 400 });
      purchased.push(filter);
      return new Response(JSON.stringify({ snapshot_id: `snap_${purchased.length}` }), { status: 200 });
    }
    // выборки ещё собираются — у самого сбора ошибок нет
    if (url.includes("/download")) return new Response("", { status: 202 });
    return new Response("{}", { status: 200 });
  };
  const { db, state } = sourcesDb({});
  const first = await withFetch(handler, () => triggerBrightData(db, { only: "S003", force: true }));
  assert.equal(first[0].ok, false);
  assert.equal(first[0].triggered, 3, "основные куртки и сумки и сумки коллабораций куплены");
  assert.ok(purchased.some((f) => f.includes("Special Collaborations") && f.includes('"Bag"')), "отказ по куртками коллабораций не оставил без покупки их сумки");
  assert.match(String(lastError(state, "S003")), /не куплено: раздел «куртки» \(часть: коллаборации Uniqlo\) — .*400/);
  assert.ok(readTriggerFailure(state.caps.S003), "сбой запуска хранится отдельно от last_error");
  // Сбор в 06:30: пишет last_error заново, но сбой запуска присоединяет — иначе непокупка части пропала бы через полтора часа.
  await withFetch(handler, () => collectBrightData(db, Date.now() + 60_000));
  assert.match(String(lastError(state, "S003")), /^Bright Data: запуск \d\d\.\d\d не удался: не куплено: раздел «куртки» \(часть: коллаборации Uniqlo\)/);
  assert.equal(readPending(state.caps.S003).length, 3, "ждущие выборки — в очереди");
  assert.ok(readTriggerFailure(state.caps.S003), "и после сбора сбой хранится");
  // Запуск без сбоя (фильтр приняли) снимает сбой; следующий сбор — чисто.
  rejectCollabJackets = false;
  const second = await withFetch(handler, () => triggerBrightData(db, { only: "S003", force: true }));
  assert.ok(second.every((r) => r.ok), JSON.stringify(second));
  assert.equal(readTriggerFailure(state.caps.S003), null);
  await withFetch(handler, () => collectBrightData(db, Date.now() + 60_000));
  assert.equal(lastError(state, "S003"), null);
});

test("Сбой запуска: дата в строке — московская; старше 8 суток — не показывается (плановый запуск за это время уже был)", () => {
  const at = "2026-10-07T05:00:00.000Z";
  assert.equal(triggerFailureNote({ at, message: "x" }, Date.parse(at) + 3600 * 1000), "запуск 07.10 не удался: x");
  assert.equal(triggerFailureNote({ at: "2026-10-06T22:30:00.000Z", message: "x" }, Date.parse(at)), "запуск 07.10 не удался: x", "01:30 МСК — уже 07.10");
  assert.equal(triggerFailureNote({ at, message: "x" }, Date.parse(at) + 8 * 24 * 3600 * 1000), null);
  assert.equal(triggerFailureNote(null, Date.parse(at)), null);
  assert.equal(readTriggerFailure({ brightdata_trigger_failure: { at: "вчера", message: "x" } }), null);
});

test("Сбой запуска старше 8 суток сбор снимает и из capabilities, а не только с экрана", async () => {
  const old = new Date(Date.now() - 9 * 24 * 3600 * 1000).toISOString();
  const recent = new Date(Date.now() - 3600 * 1000).toISOString();
  const { db, state } = sourcesDb({ S046: { brightdata_trigger_failure: { at: old, message: "старый" } }, S007: { brightdata_trigger_failure: { at: recent, message: "свежий" } } });
  await withFetch(() => new Response("{}", { status: 200 }), () => collectBrightData(db, Date.now() + 60_000));
  assert.equal(readTriggerFailure(state.caps.S046), null);
  assert.equal(lastError(state, "S046"), null);
  assert.equal(readTriggerFailure(state.caps.S007)?.message, "свежий", "свежий сбой хранится до удачного запуска");
});

test("Сбой записи очереди в цикле запуска: обработчик сбоя сохраняет и отметки покупок, а не только очередь (иначе после сбора раздел купился бы второй раз)", async () => {
  let issued = 0;
  const handler = (url: string) => {
    if (!url.includes("/datasets/v3/trigger")) return new Response("{}", { status: 200 });
    issued += 1;
    return new Response(JSON.stringify({ snapshot_id: `s_${issued}` }), { status: 200 });
  };
  let failed = false;
  const { db, state } = sourcesDb({}, (patch) => {
    const pending = (patch.capabilities as { brightdata_pending?: unknown[] } | undefined)?.brightdata_pending;
    if (!failed && pending?.length === 2) { failed = true; return true; }
    return false;
  });
  await withFetch(handler, () => triggerBrightData(db, { only: "S046" }));
  assert.equal(Object.keys(readBought(state.caps.S046)).length, 2, "обе оплаченные пробы отмечены купленными");
  assert.match(readTriggerFailure(state.caps.S046)?.message ?? "", /db write failed/);
});

test("Окончательный отказ снимает только свою отметку: более новая покупка того же раздела (force=1) остаётся", async () => {
  const older = new Date(Date.now() - 5 * 3600 * 1000).toISOString();
  const newer = new Date(Date.now() - 3600 * 1000).toISOString();
  const { db, state } = sourcesDb({ S001: { brightdata_pending: [{ ...pendingFor("snap_old", older), datasetId: ZARA_DS }], brightdata_bought: { [`${ZARA_DS}|jackets`]: newer } } });
  await withFetch(() => new Response("gone", { status: 404 }), () => collectBrightData(db, Date.now() + 60_000));
  assert.equal(readBought(state.caps.S001)[`${ZARA_DS}|jackets`], newer);
});

const chaquetaTarget = BRIGHTDATA_TARGETS.find((t) => t.part === "zara_chaqueta")!;
const zaraMainJackets = BRIGHTDATA_TARGETS.find((t) => t.sourceId === "S001" && t.direction === "jackets" && !t.part)!;
const chaquetaSnapshot = (snapshotId: string) => ({
  snapshotId, datasetId: ZARA_DS, direction: "jackets", method: "brightdata_zara", triggeredAt: new Date(Date.now() - 3600 * 1000).toISOString(), kind: "dataset", part: "zara_chaqueta",
  recordsLimit: chaquetaTarget.recordsLimit, coverage: filterSignature(chaquetaTarget.filter), targetKey: targetSignature(chaquetaTarget),
});
const catalogRow = (id: string, title: string) => ({
  source_id: "S001", source_item_id: id, direction: "jackets", baseline: true, reference_id: null, title, model_key: modelKey({ sourceId: "S001", sourceItemId: id, title }),
  handle: `https://www.zara.com/us/en/x-p${id.padStart(8, "0")}.html`, image_urls: ["https://static.zara.net/assets/public/ok.jpg"], last_seen_at: new Date().toISOString(),
});
/** 50 известных курток основной выборки Zara: раздел курток уже не пуст. */
const knownZaraJackets = () => Array.from({ length: 50 }, (_, i) => catalogRow(String(9000000 + i), `KNOWN JACKET ${i}`));
const chaquetaJacket = (i: number) => zaraChaqueta(`POCKET JACKET ${i}`, { product_id: 5850000 + i, url: `https://www.zara.com/us/en/pocket-jacket-p0${5850000 + i}.html` });
const collectZara = (db: never, records: unknown[], snapshotId: string) => withFetch((url) => {
  if (url.includes(`/datasets/snapshots/${snapshotId}/download`)) return new Response(JSON.stringify(records), { status: 200 });
  if (url.includes("/datasets/filter")) return new Response(JSON.stringify({ snapshot_id: "snap_photos" }), { status: 200 });
  return new Response("{}", { status: 200 });
}, () => collectBrightData(db, Date.now() + 60_000));
const partRows = (tables: Record<string, Row[]>) => (tables.assortment_source_items ?? []).filter((r) => String(r.source_item_id).startsWith("585"));

test("Первый сбор части при НЕпустом разделе курток Zara — база для части: старые модели CHAQUETA новинками не становятся", async () => {
  const { db, tables, caps } = catalogMemoryDb({ S001: { brightdata_pending: [chaquetaSnapshot("snap_c1")], brightdata_coverage: { [`${ZARA_DS}|jackets`]: filterSignature(zaraMainJackets.filter) } } });
  tables.assortment_source_items = knownZaraJackets();
  await collectZara(db, Array.from({ length: 8 }, (_, i) => chaquetaJacket(i)), "snap_c1");
  const rows = partRows(tables);
  assert.equal(rows.length, 8);
  assert.ok(rows.every((r) => r.baseline === true), "охват части ещё не запомнен — сбор лёг базой, хотя раздел курток известен");
  assert.equal(readCoverage(caps("S001"))[`${ZARA_DS}|jackets|zara_chaqueta`], filterSignature(chaquetaTarget.filter), "охват части запомнен");
  assert.deepEqual((tables.assortment_run ?? []).map((r) => [r.coverage, r.part]), [["window", "zara_chaqueta"]], "прогон части помечен в журнале: «История наблюдений» не примет его за последний прогон источника");
});

test("Вторая неделя части: новые модели CHAQUETA — новинки (охват части запомнен, сбору верим), известные — нет", async () => {
  const { db, tables } = catalogMemoryDb({ S001: {
    brightdata_pending: [chaquetaSnapshot("snap_c2")],
    brightdata_coverage: { [`${ZARA_DS}|jackets`]: filterSignature(zaraMainJackets.filter), [`${ZARA_DS}|jackets|zara_chaqueta`]: filterSignature(chaquetaTarget.filter) },
  } });
  tables.assortment_source_items = [...knownZaraJackets(), ...Array.from({ length: 8 }, (_, i) => catalogRow(String(5850000 + i), `POCKET JACKET ${i}`))];
  await collectZara(db, Array.from({ length: 11 }, (_, i) => chaquetaJacket(i)), "snap_c2");
  const rows = partRows(tables);
  assert.deepEqual(rows.filter((r) => r.baseline === false).map((r) => r.source_item_id).sort(), ["5850008", "5850009", "5850010"], "три новые модели — кандидаты в новинки");
  assert.ok(rows.filter((r) => Number(r.source_item_id) < 5850008).every((r) => r.baseline === true));
});

test("Потолок части — по всем оплаченным записям: 600 из 600 пришло, правило оставило 10 — выборка обрезана, новинок нет, предупреждение видно", async () => {
  // Охват части запомнен (вторая неделя): не будь выборка обрезана, новые модели стали бы новинками.
  const { db, tables } = catalogMemoryDb({ S001: {
    brightdata_pending: [chaquetaSnapshot("snap_c3")],
    brightdata_coverage: { [`${ZARA_DS}|jackets`]: filterSignature(zaraMainJackets.filter), [`${ZARA_DS}|jackets|zara_chaqueta`]: filterSignature(chaquetaTarget.filter) },
  } });
  tables.assortment_source_items = knownZaraJackets();
  const knit = Array.from({ length: 590 }, (_, i) => zaraChaqueta(`CROPPED KNIT JACKET ${i}`, { product_id: 7000000 + i, url: `https://www.zara.com/us/en/knit-p0${7000000 + i}.html` }));
  await collectZara(db, [...Array.from({ length: 10 }, (_, i) => chaquetaJacket(i)), ...knit], "snap_c3");
  const rows = partRows(tables);
  assert.equal(rows.length, 10, "в раздел — только прошедшие правило");
  assert.ok(rows.every((r) => r.baseline === true), "обрезанная выборка новинок не даёт: невиданное там — не обязательно новое");
  const source = tables.assortment_sources.find((r) => r.source_id === "S001")!;
  assert.match(String(source.last_error), /часть: Zara CHAQUETA без трикотажа\) больше потолка выборки \(600\)/);
});

test("Правило части Zara CHAQUETA: трикотаж в обычных для Zara формулировках отсекается, трикотажная отделка куртки — нет", () => {
  const keep = (name: string, extra: Record<string, unknown> = {}) => keepPartRecord("zara_chaqueta", "jackets", zaraChaqueta(name, extra));
  assert.equal(keep("SOFT JACKET", { description: "Jacket made of a soft knit fabric. Lapel collar and long sleeves." }), false, "«knit fabric» в описании — трикотаж");
  assert.equal(keep("CROPPED JACKET WITH BUTTONS", { description: "Cropped jacket made of spun yarn. Round neck." }), false, "пряжа");
  assert.equal(keep("SHORT JACKET", { description: "Pointelle jacket with a round neck." }), false);
  assert.equal(keep("SHORT JACKET", { description: "Jacket in purl stitch." }), false);
  for (const name of ["RIBBED JACKET", "POINTELLE JACKET", "MOHAIR BLEND JACKET", "ALPACA BLEND JACKET", "CHAQUETA CANALÉ", "AMERICANA CRUZADA"]) assert.equal(keep(name), false, name);
  assert.equal(keep("BOMBER JACKET WITH RIBBED TRIMS"), true, "рубчик отделки — не трикотаж");
  assert.equal(keep("BOMBER JACKET", { description: "Bomber jacket. Ribbed knit collar, cuffs and hem. Front zip closure." }), true);
  assert.equal(keep("PADDED JACKET", { description: "Padded jacket with a knit collar and rib-knit trim." }), true);
  assert.equal(keep("PUFFER JACKET", { description: "Puffer jacket with a high neck. Knit lining." }), true, "трикотажная подкладка — не трикотаж");
  assert.equal(keep("HIGH-NECK POCKET JACKET", { description: "Jacket with a high neck. Front zip closure." }), true);
  // Буклé — фактура пряжи: у Zara чаще тканый жакет; вязаный буклé выдаёт «knit» в названии или описании.
  assert.equal(keep("BOUCLÉ JACKET", { description: "Jacket made of bouclé fabric. Lapel collar. Patch pockets." }), true);
  assert.equal(keep("BOUCLÉ JACKET", { description: "Bouclé knit jacket with a round neck." }), false);
  const notInName = (chaquetaTarget.filter as { filters: Array<{ name: string; operator: string; value: unknown }> }).filters.find((f) => f.name === "product_name")!.value as string[];
  for (const word of ["POINTELLE", "MOHAIR", "ALPACA"]) assert.ok(notInName.includes(word), `не платим за «${word}»`);
  assert.ok(!notInName.includes("RIBBED"), "«RIBBED» — подстрока и «… WITH RIBBED TRIMS»: в фильтр набора не идёт");
});

test("Правило коллабораций Uniqlo: жилет — только верхний, «UNIQLO : C Puffer Skirt» — юбка; главное слово — куртка", () => {
  const keep = (title: string, category?: string) => keepPartRecord("uniqlo_collab", "jackets", uniqloCollab(title, category));
  for (const title of ["Tailored Vest", "Linen Blend Vest", "Ribbed Vest", "Mesh Vest", "UNIQLO : C Puffer Skirt", "Hybrid Down"]) assert.equal(keep(title), false, title);
  for (const title of ["Light Down Vest", "Fleece Vest", "Padded Gilet", "Hybrid Down Short Jacket", "UNIQLO : C Puffer Jacket", "Light Down Vest Jacket"]) assert.equal(keep(title), true, title);
  for (const title of ["Padded Vest", "Puffer Vest", "PUFFTECH Vest", "Quilted Vest", "Insulated Vest"]) assert.equal(keep(title), true, `верхний жилет: ${title}`);
  assert.equal(keep("Utility Vest", "WOMEN > Special Collaborations > Uniqlo U > Outerwear > Utility Vest"), true, "по разделу «Outerwear» жилет — верхний");
  assert.equal(keep("Alpaca Blend Coat"), true, "у Uniqlo альпака — тканое пальто, не трикотаж");
});

test("Сумки коллабораций Uniqlo: «Baggy» в фильтре набора отсечён — брюки не съедают потолок и не оплачиваются", () => {
  const bags = BRIGHTDATA_TARGETS.find((t) => t.part === "uniqlo_collab" && t.direction === "bags")!;
  const filters = (bags.filter as { filters: Array<{ name: string; operator: string; value: unknown }> }).filters;
  const not = filters.filter((f) => f.name === "title" && f.operator === "not_includes").flatMap((f) => f.value as string[]);
  assert.ok(not.includes("Baggy") && not.includes("baggy"));
  assert.ok(!not.includes("Charm"), "«… Bag with Charm» — сумка");
});

test("Фото Zara: первыми — модели с находкой в ленте; базовые строки без фото (CHAQUETA) их не вытесняют за потолок 400 моделей", async () => {
  const seen = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { db, tables } = catalogMemoryDb({ S001: {} });
  tables.assortment_source_items = Array.from({ length: 450 }, (_, i) => ({
    source_id: "S001", source_item_id: `id${String(i).padStart(4, "0")}`, direction: "jackets", handle: `https://www.zara.com/us/en/x-p${10000000 + i}.html`,
    reference_id: i >= 445 ? `ref-${i}` : null, image_urls: null, last_seen_at: seen,
  }));
  let body: { filter: { filters: Array<{ name: string; value: unknown }> } } | null = null;
  await withFetch((url, init) => {
    if (!url.includes("/datasets/filter")) return new Response("{}", { status: 200 });
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ snapshot_id: "snap_ph" }), { status: 200 });
  }, () => triggerZaraPhotos(db));
  const codes = (body as unknown as { filter: { filters: Array<{ name: string; value: unknown }> } }).filter.filters.find((f) => f.name === "group_id")!.value as string[];
  assert.equal(codes.length, 400);
  assert.deepEqual(codes.slice(0, 5), ["10000445", "10000446", "10000447", "10000448", "10000449"], "находки в ленте — первыми");
  assert.deepEqual(codes.slice(5, 7), ["10000000", "10000001"], "дальше — по номеру, как раньше");
});

test("force=1 накануне планового дня заменяет плановую покупку — так и записано в документации", async () => {
  const tuesday = new Date("2026-10-06T10:00:00Z");
  let purchases = 0;
  const handler = (url: string) => {
    if (!url.includes("/datasets/filter")) return new Response("{}", { status: 200 });
    purchases += 1;
    return new Response(JSON.stringify({ snapshot_id: `snap_${purchases}` }), { status: 200 });
  };
  const { db } = sourcesDb({});
  await withFetch(handler, () => triggerBrightData(db, { only: "S001", force: true, now: tuesday }));
  const forced = purchases;
  await withFetch(handler, () => triggerBrightData(db, { only: "S001", now: new Date("2026-10-07T05:00:00Z") }));
  assert.equal(purchases, forced, "плановый запуск среды ничего не купил: выборки вторника ждут сбора");
  const docs = readFileSync(join(root, "docs/assortment-development-integration.md"), "utf8");
  assert.match(docs, /`force=1` накануне планового дня заменяет плановую покупку/);
});

// --- Ф2: общий потолок движка, учёт расхода, «нет денег» (402) ---

const WEDNESDAY = new Date("2026-10-07T05:00:00Z");
const ENGINE = { weeklyUsd: 30, socialWeeklyUsd: 3 };
const spentToday = (kind: string, cost: number) => ({ day: "2026-10-07", kind, calls: 1, failed_calls: 0, input_tokens: 0, output_tokens: 0, cost_usd: cost, updated_at: "2026-10-07T04:00:00.000Z" });
/** Подставной Bright Data: платные вызовы (выборка набора, запуск сборщика) считаются; ответ — номер пробы или заданная ошибка. */
function paidBrightData(fail?: (url: string) => Response | null) {
  const paid: Array<{ url: string; body: Record<string, unknown> | unknown[] }> = [];
  const handler = (url: string, init?: RequestInit) => {
    const failure = fail?.(url);
    if (failure) {
      if (url.includes("/datasets/filter") || url.includes("/datasets/v3/trigger")) paid.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
      return failure;
    }
    if (url.includes("/datasets/filter") || url.includes("/datasets/v3/trigger")) {
      paid.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
      return new Response(JSON.stringify({ snapshot_id: `snap_${paid.length}` }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  };
  return { paid, handler };
}

test("Ф2, потолок движка до платного запуска: при $25 из $30 (разбор по фото и рилсы) Zara и Uniqlo по средам куплены, а части разделов, ASOS и H&M — нет и названы", async () => {
  const { db, state } = sourcesDb({}, undefined, [spentToday("catalog_attributes", 23), spentToday("brightdata_social", 2)]);
  const { paid, handler } = paidBrightData();
  const results = await withFetch(handler, () => triggerBrightData(db, { now: WEDNESDAY, engine: ENGINE }));
  // Норма Zara и Uniqlo — $5 сверху (2,5 + 0,75 + 1 + 0,75): в остаток $5 она помещается целиком, остальное уже нет.
  assert.deepEqual(paid.map((p) => [p.url.includes("/datasets/filter") ? "набор" : "сборщик", (p.body as { records_limit?: number }).records_limit ?? null]), [
    ["набор", 1000], ["набор", 300], ["набор", 400], ["набор", 300],
  ], "куплены только основные выборки Zara и Uniqlo; сборщики ASOS и H&M не запускались");
  const asos = results.find((r) => r.sourceId === "S046")!;
  assert.equal(asos.ok, false);
  assert.equal(asos.refusedByBudget, 4);
  assert.match(String(state.patches.filter((p) => p.id === "S046").pop()!.patch.last_error), /не куплено по потолку движка: .*общий потолок движка: запуск ≈\$0,06 \(оценка\) не помещается в остаток \$0,00 — за 7 дней \$25,00 из \$30,00, под каталоги отложено \$5,00/);
  const zara = results.find((r) => r.sourceId === "S001")!;
  assert.deepEqual([zara.triggered, zara.refusedByBudget], [2, 1], "Zara: куртки и сумки куплены, часть CHAQUETA — нет");
  assert.equal(readTriggerFailure(state.caps.S001)?.message.includes("Zara CHAQUETA без трикотажа"), true, "не купленная часть видна в «Источниках» до следующего удачного запуска");
  assert.equal(results.find((r) => r.sourceId === "S003")!.triggered, 2);
  assert.equal(results.find((r) => r.sourceId === "S007")!.refusedByBudget, 2);
});

test("Ф2, потолок выбран: ни одного платного вызова Bright Data; без таблицы учёта — прежнее правило; учёт не прочитался — не покупаем вслепую", async () => {
  const full = sourcesDb({}, undefined, [spentToday("catalog_attributes", 20), spentToday("brightdata:zara", 10)]);
  const a = paidBrightData();
  const results = await withFetch(a.handler, () => triggerBrightData(full.db, { now: WEDNESDAY, engine: ENGINE }));
  assert.equal(a.paid.length, 0, "ни одной покупки");
  assert.ok(results.length > 0 && results.every((r) => !r.ok && (r.refusedByBudget ?? 0) > 0));
  // Пробы, оплаченные раньше и ещё не собранные, — тоже в неделе: второй запуск в тот же день потолок свободным не видит.
  const pendingZara = BRIGHTDATA_TARGETS.filter((t) => t.sourceId === "S001" && !t.part).map((t, i) => ({ snapshotId: `snap_p${i}`, datasetId: t.datasetId, direction: t.direction, method: t.method, triggeredAt: "2026-10-07T04:00:00.000Z", kind: "dataset", recordsLimit: t.recordsLimit, targetKey: targetSignature(t) }));
  // Неделя $24,75 + оплаченная утром и не собранная Zara (оценка $3,25) = $28: повторная покупка курток ($2,5) не помещается, сумки ($0,75) — да.
  // Без учёта проб в очереди куртки купились бы второй раз (остаток выглядел бы как $5,25).
  const inflight = sourcesDb({ S001: { brightdata_pending: pendingZara } }, undefined, [spentToday("catalog_attributes", 23), spentToday("brightdata_social", 1.75)]);
  const b = paidBrightData();
  await withFetch(b.handler, () => triggerBrightData(inflight.db, { now: WEDNESDAY, engine: ENGINE, only: "S001", force: true }));
  assert.deepEqual(b.paid.map((p) => (p.body as { records_limit?: number }).records_limit), [300], "куплены только сумки");
  // Учёт не прочитался — покупок нет, причина в «Источниках».
  const broken = sourcesDb({});
  const brokenDb = { from: (table: string) => (table === "assortment_ai_usage" ? { select: () => ({ gte: () => Promise.resolve({ data: null, error: { message: "таймаут запроса" } }) }) } : (broken.db as unknown as { from: (t: string) => unknown }).from(table)) } as never;
  const d = paidBrightData();
  const blocked = await withFetch(d.handler, () => triggerBrightData(brokenDb, { now: WEDNESDAY, engine: ENGINE, only: "S001" }));
  assert.equal(d.paid.length, 0);
  assert.match(String(blocked[0].error), /учёт расхода движка не прочитался: таймаут запроса — платный запуск отложен/);
  // Таблицы учёта нет (миграция 202610050005 не применена) — учесть нечем: прежнее правило без потолка, код не падает.
  const noTable = sourcesDb({});
  const noTableDb = { from: (table: string) => (table === "assortment_ai_usage" ? { select: () => ({ gte: () => Promise.resolve({ data: null, error: { code: "42P01", message: 'relation "public.assortment_ai_usage" does not exist' } }) }) } : (noTable.db as unknown as { from: (t: string) => unknown }).from(table)) } as never;
  const e = paidBrightData();
  await withFetch(e.handler, () => triggerBrightData(noTableDb, { now: WEDNESDAY, engine: ENGINE, only: "S001" }));
  assert.equal(e.paid.length, 3, "куртки, сумки и часть CHAQUETA — как до Ф2");
});

test("Ф2, «нет денег» (402 / Customer is not active) при покупке: стоп всего запуска одной причиной, оплаченное сохранено, остальным источникам дня — та же причина; в журнале — одна строка с меткой [stop:billing]", async () => {
  let attempts = 0;
  const { paid, handler } = paidBrightData((url) => {
    if (!url.includes("/datasets/filter") && !url.includes("/datasets/v3/trigger")) return null;
    attempts += 1;
    return attempts === 3 ? new Response("Customer is not active", { status: 402 }) : null;
  });
  const { db, state } = sourcesDb({}, undefined, []);
  const results = await withFetch(handler, () => triggerBrightData(db, { now: WEDNESDAY, engine: ENGINE }));
  assert.equal(paid.length, 3, "после 402 ни одной попытки покупки: следующие цели получили бы тот же ответ");
  assert.deepEqual(readPending(state.caps.S046).map((p) => p.snapshotId), ["snap_1", "snap_2"], "две оплаченные до 402 пробы ASOS сохранены");
  assert.deepEqual(results.map((r) => [r.sourceId, r.billing ?? false]), [["S046", true], ["S001", true], ["S003", true], ["S007", true]]);
  for (const id of ["S001", "S003", "S007"]) assert.match(String(readTriggerFailure(state.caps[id])?.message), /не куплено: Bright Data — нет денег или аккаунт не активен \(402\)/, `${id}: причина в «Источниках»`);
  const log = brightdataRunLog(results);
  assert.equal(log.status, "error");
  assert.match(String(log.note), /^Bright Data: нет денег или аккаунт не активен \(402\)/);
  assert.equal((String(log.note).match(/\[stop:billing\]/g) ?? []).length, 1, "одна метка в конце строки");
  assert.match(String(log.note), /\[stop:billing\]$/);
});

test("Ф2, «нет денег» при сборе: выборка остаётся в очереди с пометкой и ждёт пополнения дольше суток; выборки других источников не скачиваются, а помечаются; расход не учитывается, пока выборку не забрали", async () => {
  const at = "2026-10-07T05:00:00.000Z";
  const asos = BRIGHTDATA_TARGETS.find((t) => t.sourceId === "S046")!;
  const zaraJackets = BRIGHTDATA_TARGETS.find((t) => t.sourceId === "S001" && t.direction === "jackets" && !t.part)!;
  const { db, tables, caps } = catalogMemoryDb({
    S046: { brightdata_pending: [
      { snapshotId: "sd_asos", datasetId: asos.datasetId, direction: asos.direction, method: asos.method, triggeredAt: at, kind: "collect", targetKey: targetSignature(asos) },
      { snapshotId: "sd_asos2", datasetId: asos.datasetId, direction: asos.direction, method: asos.method, triggeredAt: at, kind: "collect", targetKey: "other" },
    ] },
    S001: { brightdata_pending: [{ snapshotId: "snap_zara", datasetId: ZARA_DS, direction: "jackets", method: "brightdata_zara", triggeredAt: at, kind: "dataset", recordsLimit: 1000, coverage: filterSignature(zaraJackets.filter), targetKey: targetSignature(zaraJackets) }], brightdata_photo_pending: [{ snapshotId: "snap_ph", triggeredAt: at }] },
  });
  const calls: string[] = [];
  const results = await withFetch((url) => {
    calls.push(url);
    if (url.includes("/progress/sd_asos")) return new Response(JSON.stringify({ message: "Customer is not active" }), { status: 402 });
    return new Response("{}", { status: 200 });
  }, () => collectBrightData(db, Date.now() + 60_000));
  assert.deepEqual(calls.map((u) => new URL(u).pathname), ["/datasets/v3/progress/sd_asos"], "после 402 ни одного скачивания");
  assert.ok(results.every((r) => r.billing), "у всех источников с очередью — одна причина");
  const asosLeft = readPending(caps("S046"));
  const zaraLeft = readPending(caps("S001"));
  assert.deepEqual([asosLeft.map((p) => p.snapshotId), zaraLeft.map((p) => p.snapshotId), readPhotoPending(caps("S001")).map((p) => p.snapshotId)], [["sd_asos", "sd_asos2"], ["snap_zara"], ["snap_ph"]], "оплаченные выборки на месте — и вторая проба ASOS, которую после 402 уже не запрашивали");
  const later = Date.parse(at) + 30 * 3600 * 1000;
  assert.ok([...asosLeft, ...zaraLeft, ...readPhotoPending(caps("S001"))].every((p) => p.billingHeldAt && pendingAlive(p, later)), "через 30 часов (дольше суток) выборки всё ещё ждут");
  assert.equal(pendingAlive(zaraLeft[0], Date.parse(at) + BILLING_HOLD_TTL_MS + 1), false, "но не вечно");
  assert.equal(pendingAlive({ triggeredAt: at }, later), false, "обычная проба через 30 часов — уже нет");
  assert.equal((tables.assortment_ai_usage ?? []).length, 0, "за не забранную выборку расход не записан");
  assert.match(String(tables.assortment_sources.find((r) => r.source_id === "S001")!.last_error), /нет денег или аккаунт не активен \(402\).*ждут в очереди: 2/);
  const log = brightdataRunLog(results);
  assert.equal(log.status, "error");
  assert.match(String(log.note), /\[stop:billing\]$/);
});

test("Ф2, учёт расхода Bright Data: пришедшие записи × цена метода (оценка) — набор $2,5 за 1 000, сборщик $1,5 за 1 000; статья — бренд или часть раздела; учитывается один раз", async () => {
  const fresh = new Date(Date.now() - 3600 * 1000).toISOString();
  const chaqueta = BRIGHTDATA_TARGETS.find((t) => t.part === "zara_chaqueta")!;
  const asos = BRIGHTDATA_TARGETS.find((t) => t.sourceId === "S046")!;
  const { db, tables } = catalogMemoryDb({
    S001: { brightdata_pending: [{ snapshotId: "snap_chaq", datasetId: ZARA_DS, direction: "jackets", method: "brightdata_zara", triggeredAt: fresh, kind: "dataset", part: "zara_chaqueta", recordsLimit: 600, coverage: filterSignature(chaqueta.filter), targetKey: targetSignature(chaqueta) }] },
    S046: { brightdata_pending: [{ snapshotId: "sd_asos", datasetId: asos.datasetId, direction: asos.direction, method: asos.method, triggeredAt: fresh, kind: "collect", targetKey: targetSignature(asos) }] },
  });
  // 40 записей CHAQUETA (за все заплачено, хотя правило части оставит меньше) и 30 записей ASOS + строка-ошибка сборщика.
  const chaq = Array.from({ length: 40 }, (_, i) => zaraChaqueta(i % 2 ? "CROPPED KNIT JACKET" : "POCKET JACKET", { product_id: 7000000 + i, url: `https://www.zara.com/us/en/jacket-p0${7000000 + i}.html` }));
  const asosRows = [...Array.from({ length: 30 }, (_, i) => ({ url: `https://www.asos.com/x/prd/${i}`, name: `Hobo bag ${i}`, product_id: 900 + i, category: "Bags" })), { error: "Crawler error", input: { keyword: "hobo bag" } }];
  const results = await withFetch((url) => {
    if (url.includes("/datasets/snapshots/snap_chaq/download")) return new Response(JSON.stringify(chaq), { status: 200 });
    if (url.includes("/progress/sd_asos")) return new Response(JSON.stringify({ status: "ready" }), { status: 200 });
    if (url.includes("/datasets/v3/snapshot/sd_asos")) return new Response(JSON.stringify(asosRows), { status: 200 });
    if (url.includes("/datasets/filter")) return new Response(JSON.stringify({ snapshot_id: "snap_photos" }), { status: 200 });
    return new Response("{}", { status: 200 });
  }, () => collectBrightData(db, Date.now() + 60_000, { engine: ENGINE }));
  const usage = Object.fromEntries((tables.assortment_ai_usage ?? []).map((r) => [r.kind, [r.calls, r.cost_usd]]));
  assert.deepEqual(usage, { "brightdata:zara_chaqueta": [40, 0.1], "brightdata:asos": [30, 0.045] });
  assert.equal(results.find((r) => r.sourceId === "S001")!.spentUsd, 0.1);
  assert.equal(results.find((r) => r.sourceId === "S046")!.spentUsd, 0.045);
  // Повторный сбор: очередь пуста — ни записей, ни расхода второй раз.
  await withFetch(() => new Response("{}", { status: 200 }), () => collectBrightData(db, Date.now() + 60_000, { engine: ENGINE }));
  assert.deepEqual(Object.fromEntries((tables.assortment_ai_usage ?? []).map((r) => [r.kind, r.calls])), { "brightdata:zara_chaqueta": 40, "brightdata:asos": 30 });
});

test("Ф2, потолок в одном запуске: каждая покупка уменьшает остаток — при $26,5 из $30 куплены куртки и сумки Zara, на Uniqlo места не осталось", async () => {
  const { db } = sourcesDb({}, undefined, [spentToday("catalog_attributes", 24.5), spentToday("brightdata_social", 2)]);
  const { paid, handler } = paidBrightData();
  const results = await withFetch(handler, () => triggerBrightData(db, { now: WEDNESDAY, engine: ENGINE }));
  assert.deepEqual(paid.map((p) => (p.body as { records_limit?: number }).records_limit), [1000, 300], "2,5 + 0,75 из остатка 3,5 — дальше 0,25: Uniqlo ($1 и $0,75) не помещается");
  assert.equal(results.find((r) => r.sourceId === "S003")!.refusedByBudget, 4);
});

test("Ф2, выборка фото Zara — тоже под потолком: после сбора Zara при выбранной неделе новая выборка не заказывается (и вручную ?phase=photos), причина видна", async () => {
  const fresh = new Date(Date.now() - 3600 * 1000).toISOString();
  const chaqueta = BRIGHTDATA_TARGETS.find((t) => t.part === "zara_chaqueta")!;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow" }).format(new Date());
  const { db, tables } = catalogMemoryDb({ S001: { brightdata_pending: [{ snapshotId: "snap_chaq", datasetId: ZARA_DS, direction: "jackets", method: "brightdata_zara", triggeredAt: fresh, kind: "dataset", part: "zara_chaqueta", recordsLimit: 600, coverage: filterSignature(chaqueta.filter), targetKey: targetSignature(chaqueta) }] } });
  (tables.assortment_ai_usage ??= []).push({ day: today, kind: "catalog_attributes", calls: 1, cost_usd: 29.9, updated_at: fresh });
  const filters: string[] = [];
  const handler = (url: string) => {
    if (url.includes("/datasets/snapshots/snap_chaq/download")) return new Response(JSON.stringify([zaraChaqueta("HIGH-NECK POCKET JACKET")]), { status: 200 });
    if (url.includes("/datasets/filter")) { filters.push(url); return new Response(JSON.stringify({ snapshot_id: "snap_photos" }), { status: 200 }); }
    return new Response("{}", { status: 200 });
  };
  const results = await withFetch(handler, () => collectBrightData(db, Date.now() + 60_000, { engine: ENGINE }));
  assert.equal(filters.length, 0, "выборка фото не заказана");
  assert.match(String(results.find((r) => r.sourceId === "S001")!.error), /фото Zara не заказаны: общий потолок движка/);
  const manual = await withFetch(handler, () => requestZaraPhotos(db, Date.now() + 60_000, { engine: ENGINE }));
  assert.equal(filters.length, 0);
  assert.equal(manual.ok, false);
  assert.match(String(manual.error), /^новая выборка не заказана: общий потолок движка/);
});
