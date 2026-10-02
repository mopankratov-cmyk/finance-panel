import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripMoney } from "../lib/assortment/brightdata.ts";
import { asCatalogItem, BRIGHTDATA_TARGETS, mapRecord, readPending, writePending } from "../lib/assortment/brightdataCatalog.ts";
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
  assert.deepEqual(record.images, ["https://images.asos-media.com/a.jpg", "https://images.asos-media.com/b.jpg"]);
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

test("Цели сбора: только ASOS и H&M паспорта, разумные лимиты, без Ozon", () => {
  const sources = new Set(BRIGHTDATA_TARGETS.map((t) => t.sourceId));
  assert.deepEqual([...sources].sort(), ["S007", "S046"]);
  const perRun = BRIGHTDATA_TARGETS.reduce((s, t) => s + t.limitPerInput * t.inputs.length, 0);
  assert.ok(perRun <= 200, `за прогон ${perRun} записей`);
  assert.doesNotMatch(JSON.stringify(BRIGHTDATA_TARGETS), /ozon/i);
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
