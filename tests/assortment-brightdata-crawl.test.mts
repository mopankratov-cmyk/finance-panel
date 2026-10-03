import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripMoney } from "../lib/assortment/brightdata.ts";
import { asCatalogItem, BRIGHTDATA_TARGETS, mapRecord, readPending, uniqueRecords, writePending } from "../lib/assortment/brightdataCatalog.ts";
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

test("Цели сбора: Zara (набор), ASOS и H&M паспорта, разумные лимиты, без Ozon", () => {
  const sources = new Set(BRIGHTDATA_TARGETS.map((t) => t.sourceId));
  assert.deepEqual([...sources].sort(), ["S001", "S007", "S046"]);
  const collect = BRIGHTDATA_TARGETS.filter((t) => t.kind !== "dataset").reduce((s, t) => s + t.limitPerInput * t.inputs.length, 0);
  const dataset = BRIGHTDATA_TARGETS.filter((t) => t.kind === "dataset").reduce((s, t) => s + (t.recordsLimit ?? 0), 0);
  assert.ok(collect <= 200, `сборщики: ${collect} записей за прогон`);
  assert.ok(dataset <= 200, `наборы: ${dataset} записей в неделю`);
  assert.doesNotMatch(JSON.stringify(BRIGHTDATA_TARGETS), /ozon/i);
});

test("Zara — готовый набор раз в неделю: женское, без кардиганов, английская витрина", () => {
  const zara = BRIGHTDATA_TARGETS.filter((t) => t.sourceId === "S001");
  assert.ok(zara.every((t) => t.kind === "dataset" && t.weekdayUtc === 3 && t.trustDirection));
  const text = JSON.stringify(zara.map((t) => t.filter));
  assert.match(text, /"WOMAN"/);
  assert.match(text, /CAZADORA/);
  assert.match(text, /BOLSO/);
  assert.doesNotMatch(text, /CHAQUETA/, "в CHAQUETA у Zara кардиганы");
  assert.match(text, /"\/en\/"/);
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
  assert.match(source, /knownIds\(db, source\.sourceId, snapshot\.direction\)/);
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
