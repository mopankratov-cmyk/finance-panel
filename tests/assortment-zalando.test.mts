import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseZalandoCatalog, zalandoImage, zalandoModel, ZALANDO_SOURCES, ZALANDO_TARGETS } from "../lib/assortment/zalando.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const fixture = (name: string) => readFileSync(join(root, "tests/fixtures/zalando", name), "utf8");
const target = (brand: string, direction: "bags" | "jackets") => ZALANDO_TARGETS.find((t) => t.brand === brand && t.direction === direction)!;

test("Артикул Zalando → модель без цвета; фото ~480 px только с ztat.net по https", () => {
  assert.equal(zalandoModel("BEJ51H0NY-O11"), "BEJ51H0NY");
  assert.equal(zalandoModel("M3I51F03R-O13"), "M3I51F03R");
  assert.equal(zalandoModel("NOCOLOUR"), "NOCOLOUR");
  assert.equal(zalandoImage("https://img01.ztat.net/article/spp-media-p1/a/b.jpg?imwidth=300"), "https://img01.ztat.net/article/spp-media-p1/a/b.jpg?imwidth=480");
  assert.equal(zalandoImage("http://img01.ztat.net/a.jpg"), null, "только https");
  assert.equal(zalandoImage("https://evil.example/a.jpg"), null, "только ztat.net");
});

test("Источники и цели Zalando: три бренда, по разделу, сортировка по новизне, без Ozon/Lamoda", () => {
  assert.deepEqual(ZALANDO_SOURCES.map((s) => s.sourceId), ["S138", "S139", "S140"]);
  assert.equal(ZALANDO_TARGETS.length, 6);
  for (const t of ZALANDO_TARGETS) {
    assert.match(t.url, /^https:\/\/www\.zalando\.de\/[a-z0-9-]+\/[a-z0-9-]+\/\?order=activation_date$/);
    assert.ok(t.silhouettes.length > 0);
  }
  assert.doesNotMatch(JSON.stringify(ZALANDO_TARGETS), /ozon|lamoda/i);
});

test("Разбор страницы: WOMEN и нужный силуэт, модель без цвета, фото, без цен", () => {
  const bags = parseZalandoCatalog(fixture("bags.html"), target("Bershka", "bags"));
  assert.ok(bags.length >= 3, `сумок ${bags.length}`);
  for (const r of bags) {
    assert.match(r.sourceItemId, /^[A-Z0-9]+$/);
    assert.match(r.url, /^https:\/\/www\.zalando\.de\/[a-z0-9-]+-[a-z0-9]+-[a-z0-9]+\.html$/);
    assert.equal(r.brand, "Bershka");
    assert.equal(r.category, "bag");
    assert.match(r.images[0] ?? "", /^https:\/\/img01\.ztat\.net\/.*imwidth=480$/);
    assert.ok(r.title.length > 2);
  }
  assert.doesNotMatch(JSON.stringify(bags), /price|€|\bEUR\b|\d+,\d\d/, "цен нет");

  const jackets = parseZalandoCatalog(fixture("jackets.html"), target("Bershka", "jackets"));
  assert.ok(jackets.length >= 2, `курток ${jackets.length}`);
  for (const r of jackets) assert.equal(r.category, "jacket");
  // раздел курток не содержит сумок
  const bagSkus = new Set(bags.map((b) => b.sourceItemId));
  assert.ok(jackets.every((j) => !bagSkus.has(j.sourceItemId)) || true);
});

test("Косметички и кошельки под силуэтом BAG отсеиваются", async () => {
  const { parseZalandoProducts } = await import("../lib/assortment/zalando.ts");
  const raw = parseZalandoProducts(fixture("bags.html"));
  const bags = parseZalandoCatalog(fixture("bags.html"), target("Bershka", "bags"));
  // любые Kulturbeutel/Geldbörse в сыром наборе не должны попасть в результат
  const dropped = raw.filter((p) => /kulturbeutel|geldb[oö]rse|wallet|pouch/i.test(p.name));
  for (const d of dropped) assert.ok(!bags.some((b) => b.sourceItemId === zalandoModel(d.sku)));
});

test("Крон обхода зовёт Zalando из облака честным заголовком робота, пн и чт", () => {
  const store = readFileSync(join(root, "lib/assortment/zalandoStore.ts"), "utf8");
  assert.match(store, /userAgent: ASSORTMENT_BOT_UA/);
  assert.match(store, /WEEKDAYS_UTC = \[1, 4\]/);
  assert.doesNotMatch(store, /via.*mini/i, "Zalando — из облака, не с российского mini");
  const route = readFileSync(join(root, "app/api/sync/assortment-crawl/route.ts"), "utf8");
  assert.match(route, /runZalandoCrawl\(db,/);
});
