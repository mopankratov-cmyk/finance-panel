import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripMoney } from "../lib/assortment/brightdata.ts";
import { asCatalogItem, BRIGHTDATA_TARGETS, coverageKey, datasetVerdict, filterSignature, looksLikeChurn, mapRecord, novelCandidates, readCoverage, readPending, uniqueRecords, writeCoverage, writePending } from "../lib/assortment/brightdataCatalog.ts";
import { classifyItem } from "../lib/assortment/crawl.ts";
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
  // Потолок, а не расход: платим за пришедшие записи; 2 000 — это не больше $5 в неделю.
  assert.ok(dataset <= 2000, `наборы: потолок ${dataset} записей в неделю`);
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
  assert.doesNotMatch(text, /CHAQUETA/, "в CHAQUETA у Zara кардиганы");
  assert.match(text, /"\/us\/en\/"/, "товар повторяется по странам — одна витрина, чтобы раздел влез целиком");
  const jackets = JSON.stringify(zara.find((t) => t.direction === "jackets")!.filter);
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
  assert.deepEqual(uniqlo.map((t) => t.direction).sort(), ["bags", "jackets"]);
  assert.ok(uniqlo.every((t) => t.kind === "dataset" && t.weekdayUtc === 3 && t.datasetId === "gd_mosh3s7wdb7jafn85"));
  const jackets = JSON.stringify(uniqlo.find((t) => t.direction === "jackets")!.filter);
  assert.match(jackets, /WOMEN > Outerwear/);
  assert.match(jackets, /"not_includes","value":"Blazers"/);
  assert.match(jackets, /"-003"/);
  assert.match(jackets, /"ES"/);
  assert.match(JSON.stringify(uniqlo.find((t) => t.direction === "bags")!.filter), /WOMEN > Accessories > Bags/);
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
  assert.match(crawl, /if \(\(result\.collected \?\? 0\) > 0 && photoLeft\.length === 0\)/, "после свежего сбора Zara");
  assert.match(crawl, /r\.image_urls\.every\(\(u\) => typeof u !== "string" \|\| isDeadImageUrl\(u\)\)/, "мёртвые ссылки в базе — как «фото нет»");
  assert.match(crawl, /refs\.filter\(\(r\) => !withMedia\.has\(r\.id\)\)\.slice\(0, 20\)/, "потолок 20 — только по находкам без фото");
  assert.match(crawl, /imagesKnown: options\.imagesKnown && !livePhotos\.has\(r\.sourceItemId\)/, "еженедельный сбор не стирает живые фото из второго набора — не покупаем их заново");
  assert.match(crawl, /if \(isMissingColumnError\(error\)\) return \[\];\s*throw new Error\(error\.message\);/, "сбой базы не глотается");
  assert.match(crawl, /photoLeft\.push\(pending\);/, "сбой применения — выборка остаётся в очереди");
  assert.match(crawl, /if \(waiting\.length === 0\) \{\s*const next = await triggerZaraPhotos/, "вручную — новую выборку только если до вызова ничего не ждало: повторный вызов не покупает ещё одну");
  const route = readFileSync(join(root, "app/api/sync/assortment-brightdata/route.ts"), "utf8");
  assert.match(route, /get\("phase"\) === "photos"/);
});

test("Выборка фото не зависает: пустая — применять нечего, не удавшаяся у Bright Data — снимается, состояние видно", () => {
  const crawl = readFileSync(join(root, "lib/assortment/brightdataCrawl.ts"), "utf8");
  assert.match(crawl, /if \(response\.status === 400 && \/empty\|no \(data\|records\)\/i\.test\(text\)\) return \[\];/);
  assert.match(crawl, /const failed = e instanceof BrightDataError && e\.status !== undefined && e\.status < 500;/);
  assert.match(crawl, /result\.detail\.push\(/, "в ответе ручного запуска — номер выборки и её состояние");
});
