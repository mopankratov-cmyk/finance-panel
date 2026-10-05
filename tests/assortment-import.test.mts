import assert from "node:assert/strict";
import test from "node:test";
import {
  baseDomain,
  dedupKey,
  detectSourceId,
  extractHtmlProduct,
  fallbackTitle,
  normalizeProductUrl,
  parseShopifyProduct,
  regionFromUrl,
  shopifyProductJsonUrl,
} from "../lib/assortment/extract.ts";
import { isBlockedAddress } from "../lib/assortment/netGuard.ts";
import { parsePublicUrl, safeFetch, SafeFetchError } from "../lib/assortment/safeFetch.ts";
import { cardSignal, cleanBadge, pluralColors, type ObservationLite } from "../lib/assortment/signals.ts";
import { isUploadPath, referenceMediaPath, uploadPath } from "../lib/assortment/storage.ts";

/**
 * Импорт находок модуля «Разработка ассортимента» (этап 1.2).
 * Граница ТЗ «без цен» и защита от запросов во внутреннюю сеть ломаются
 * тихо — их и держат эти тесты.
 */

const shopifyJson = {
  product: {
    id: 8123456789,
    title: "Numéro Neuf Mini — Textured Black",
    vendor: "Polène",
    product_type: "Bags",
    published_at: "2026-09-12T10:00:00+02:00",
    tags: "Leather, New Arrival, Bestseller",
    options: [{ name: "Color", values: ["Black", "Camel", "Taupe"] }, { name: "Size", values: ["Mini"] }],
    variants: [{ sku: "", price: "450.00", compare_at_price: "520.00" }, { sku: "NN-MINI-BLK", price: "450.00" }],
    images: [{ src: "https://cdn.shopify.com/a.jpg" }, { src: "//cdn.shopify.com/b.jpg" }, { src: "https://cdn.shopify.com/a.jpg" }],
  },
};

test("Shopify: берём модель, бренд, артикул, цвета, фото и метку новинки — без цен", () => {
  const product = parseShopifyProduct(shopifyJson);
  assert.ok(product);
  assert.equal(product.sourceItemId, "8123456789");
  assert.equal(product.brand, "Polène");
  assert.equal(product.article, "NN-MINI-BLK");
  assert.deepEqual(product.colors, ["Black", "Camel", "Taupe"]);
  assert.deepEqual(product.images, ["https://cdn.shopify.com/a.jpg", "https://cdn.shopify.com/b.jpg"]);
  assert.equal(product.newBadge, "New Arrival");
  assert.equal(product.bestsellerBadge, "Bestseller");
  assert.equal(product.publishedAt, "2026-09-12T10:00:00+02:00");
  assert.doesNotMatch(JSON.stringify(product), /price|450|520|compare/i, "цены не проходят разбор");
});

test("Shopify: не карточка — null, а не исключение", () => {
  assert.equal(parseShopifyProduct({ products: [] }), null);
  assert.equal(parseShopifyProduct(null), null);
});

test("HTML: JSON-LD Product и og:-теги, offers с ценой отбрасываются", () => {
  const html = `<html><head>
    <link rel="canonical" href="/gb/jackets/coat-123?x=1&amp;y=2">
    <meta property="og:title" content="Fallback title">
    <meta property="og:image" content="https://img.example.com/og.jpg">
    <script type="application/ld+json">{"@graph":[{"@type":"Product","name":"Wool Coat","sku":"C-123","brand":{"name":"Toteme"},
      "image":["https://img.example.com/1.jpg",{"url":"https://img.example.com/2.jpg"}],"color":"Navy",
      "offers":{"price":"890","priceCurrency":"EUR"}}]}</script>
  </head></html>`;
  const product = extractHtmlProduct(html, "https://www.example.com/gb/jackets/coat-123");
  assert.equal(product.title, "Wool Coat");
  assert.equal(product.brand, "Toteme");
  assert.equal(product.article, "C-123");
  assert.deepEqual(product.colors, ["Navy"]);
  assert.equal(product.canonicalUrl, "https://www.example.com/gb/jackets/coat-123?x=1&y=2");
  assert.deepEqual(product.images, ["https://img.example.com/1.jpg", "https://img.example.com/2.jpg", "https://img.example.com/og.jpg"]);
  assert.doesNotMatch(JSON.stringify(product), /890|EUR|price/i);
});

test("HTML без JSON-LD: og:title и сломанный JSON-LD не роняют разбор", () => {
  const html = `<script type="application/ld+json">{oops</script><meta name="og:title" content="Bag &amp; Co"><title>T</title>`;
  const product = extractHtmlProduct(html, "https://shop.example.com/p/1");
  assert.equal(product.title, "Bag & Co");
  assert.deepEqual(product.images, []);
});

test("Адрес: нормализация, регион, Shopify JSON, ключ дубля и запасное название", () => {
  assert.equal(
    normalizeProductUrl("https://WWW.Polene-Paris.com/collections/new/products/numero-neuf-mini/?variant=1#top"),
    "https://polene-paris.com/products/numero-neuf-mini",
  );
  assert.equal(regionFromUrl("https://www.arket.com/en-gb/product/x"), "");
  assert.equal(regionFromUrl("https://www.cos.com/gb/women/x"), "GB");
  assert.equal(regionFromUrl("https://shop.example.com/products/x"), "");
  assert.equal(shopifyProductJsonUrl("https://brand.com/collections/a/products/coat-1?v=2"), "https://brand.com/products/coat-1.json");
  assert.equal(shopifyProductJsonUrl("https://brand.com/p/coat-1"), null);
  assert.equal(dedupKey("S014", "GB", "42", "https://x"), "S014|GB|42");
  assert.equal(dedupKey(null, "", null, "https://x/p"), "manual||https://x/p");
  assert.equal(fallbackTitle("https://www.rains.com/products/long-jacket-black"), "rains.com · long jacket black");
});

test("Источник определяется по домену из паспорта, поддомены тоже", () => {
  const sources = [
    { sourceId: "S014", seedUrls: ["https://www.polene-paris.com/collections/all"] },
    { sourceId: "S027", seedUrls: ["rains.com", "https://www.rains.com/"] },
  ];
  assert.equal(detectSourceId("https://eu.polene-paris.com/products/x", sources), "S014");
  assert.equal(detectSourceId("https://rains.com/products/x", sources), "S027");
  assert.equal(detectSourceId("https://notpolene-paris.com/x", sources), null);
  // Паспорт Polène хранит eng.polene-paris.com — витрина eu.* того же бренда тоже его.
  assert.equal(detectSourceId("https://eu.polene-paris.com/products/x", [{ sourceId: "S024", seedUrls: ["https://eng.polene-paris.com/"] }]), "S024");
  assert.equal(baseDomain("shop.brand.co.uk"), "brand.co.uk");
  assert.equal(baseDomain("www.rains.com"), "rains.com");
});

test("Защита сети: внутренние, служебные и зарезервированные адреса закрыты", () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254",
    "100.64.0.1", "100.114.33.23", "0.0.0.0", "224.0.0.1", "198.18.0.1", "::1", "::", "fd00::1", "fe80::1",
    "::ffff:127.0.0.1", "::ffff:10.0.0.1", "not-an-ip"]) {
    assert.equal(isBlockedAddress(address), true, address);
  }
  for (const address of ["8.8.8.8", "151.101.1.1", "172.32.0.1", "100.128.0.1", "2a00:1450:4001::64"]) {
    assert.equal(isBlockedAddress(address), false, address);
  }
});

test("Адрес находки: только http(s), без логина в ссылке и без нестандартных портов", () => {
  assert.equal(parsePublicUrl("https://polene-paris.com/products/x").hostname, "polene-paris.com");
  for (const raw of ["ftp://x.com/a", "file:///etc/passwd", "https://user:pass@x.com/", "http://x.com:8080/", "javascript:alert(1)", "нет"]) {
    assert.throws(() => parsePublicUrl(raw), SafeFetchError, raw);
  }
});

test("Защита сети: IPv6 во всех записях — IPv4 в hex (::ffff:7f00:1), развёрнутая и с зоной, IPv4-совместимые, NAT64, 6to4, Teredo, документация, site-local", () => {
  for (const address of [
    "::ffff:7f00:1", "::ffff:a00:1", "::ffff:a9fe:a9fe", "0:0:0:0:0:ffff:7f00:1", "0000:0000:0000:0000:0000:ffff:127.0.0.1",
    "::7f00:1", "::10.0.0.1", "64:ff9b::7f00:1", "64:ff9b::a9fe:a9fe", "64:ff9b:1::1", "2002:7f00:1::1", "2002:a9fe:a9fe::1",
    "2001:0:4136:e378:8000:63bf:3fff:fdd2", "2001:db8::1", "fec0::1", "ff02::1", "fe80::1%eth0", "100::1", "::ffff:0:0",
    "1:2:3:4:5:6:7:8:9", "::g", ":::",
  ]) {
    assert.equal(isBlockedAddress(address), true, address);
  }
  for (const address of ["::ffff:808:808", "::ffff:8.8.8.8", "64:ff9b::808:808", "2002:808:808::1", "2a00:1450:4001::64", "2606:4700:4700::1111"]) {
    assert.equal(isBlockedAddress(address), false, address);
  }
});

test("Адрес-литерал в ссылке закрыт до подключения: 127.0.0.1, [::1], 2130706433, 0x7f.1, [::ffff:7f00:1], 169.254.169.254, 10.x; редирект проверяется тем же; публичный IP и имя — проходят", async () => {
  for (const raw of ["http://127.0.0.1/", "https://[::1]/", "http://2130706433/", "http://0x7f.1/", "http://127.1/", "http://[::ffff:7f00:1]/", "http://169.254.169.254/latest/meta-data/", "http://10.0.0.5/", "https://192.168.1.1/x", "http://[fd00::1]/", "http://0.0.0.0/"]) {
    assert.throws(() => parsePublicUrl(raw), (e: unknown) => e instanceof SafeFetchError && e.code === "blocked_host", raw);
    await assert.rejects(() => safeFetch(raw, { maxBytes: 1000, timeoutMs: 1000 }), (e: unknown) => e instanceof SafeFetchError && e.code === "blocked_host", `safeFetch ${raw}`);
  }
  assert.equal(parsePublicUrl("https://8.8.8.8/x").hostname, "8.8.8.8");
  assert.equal(parsePublicUrl("https://[2606:4700:4700::1111]/").hostname, "[2606:4700:4700::1111]");
  assert.equal(parsePublicUrl("https://polene-paris.com/products/x").hostname, "polene-paris.com");
});

test("Разбор чужой HTML-страницы линеен: «<meta » × 250 000, незакрытые <script>/<link>/<title> и один гигантский «тег» не держат функцию (раньше 59 КБ — секунда, 234 КБ — 17 с)", () => {
  const started = Date.now();
  const bombs = [
    "<meta ".repeat(250_000),
    '<script type="application/ld+json">'.repeat(40_000),
    "<link ".repeat(250_000),
    "<title ".repeat(200_000),
    `<meta property="og:title" content="${"x".repeat(2_000_000)}`,
    "<meta ".repeat(100_000) + ">",
  ];
  for (const bomb of bombs) extractHtmlProduct(bomb, "https://x.example/p");
  assert.ok(Date.now() - started < 4000, `заняло ${Date.now() - started} мс`);
});

test("Границы разбора: «тег» длиннее 4096 знаков тегом не считается; JSON-LD дальше первых 1,5 МБ страницы не читается (память и время ограничены)", () => {
  const longMeta = `<meta property="og:title" content="${"x".repeat(5000)}">`;
  assert.equal(extractHtmlProduct(longMeta + "<title>Запасной</title>", "https://x.example/").title, "Запасной", "meta на 5 КБ пропущена");
  const ld = '<script type="application/ld+json">{"@type":"Product","name":"Из LD"}</script>';
  assert.equal(extractHtmlProduct(ld, "https://x.example/").title, "Из LD");
  assert.equal(extractHtmlProduct(" ".repeat(1_600_000) + ld, "https://x.example/").title, null, "блок после 1,5 МБ не читается");
});

test("Разбор HTML сохраняет прежнее поведение: регистр тегов, одинарные кавычки, порядок атрибутов, canonical с лишними атрибутами, JSON-LD в @graph, <meta> внутри script не берётся, title", () => {
  const html = `<!doctype html><HTML><HEAD>
    <TITLE>  Запасное название </TITLE>
    <META CONTENT='Название из og' PROPERTY='og:title'>
    <meta name="twitter:image" content="/img/tw.jpg" data-x="1">
    <meta property="og:image" content="https://cdn.example.com/a.jpg?x=1&amp;y=2" />
    <link rel="stylesheet" href="/a.css"><link data-rel="canonical" href="/wrong"><LINK ID=c REL="canonical" HREF="/products/real?utm=1" crossorigin>
    <script>document.write('<meta property="og:image" content="https://evil.example/x.jpg">')</script>
    <script type='application/ld+json'>{"@graph":[{"@type":"Product","name":"Из LD","sku":"SKU1","brand":{"name":"B"},"image":["https://cdn.example.com/ld.jpg"],"color":"black"}]}</script>
  </HEAD></HTML>`;
  const p = extractHtmlProduct(html, "https://shop.example.com/gb/x");
  assert.equal(p.title, "Из LD", "JSON-LD главнее og:title");
  assert.equal(p.article, "SKU1");
  assert.equal(p.brand, "B");
  assert.deepEqual(p.colors, ["black"]);
  assert.equal(p.canonicalUrl, "https://shop.example.com/products/real?utm=1", "canonical — по rel, а не по data-rel, с лишними атрибутами");
  assert.ok(p.images.includes("https://cdn.example.com/ld.jpg"));
  assert.ok(p.images.includes("https://cdn.example.com/a.jpg?x=1&y=2"), "og:image с &amp;");
  assert.ok(p.images.includes("https://shop.example.com/img/tw.jpg"), "twitter:image относительный");
  assert.ok(!p.images.some((u) => u.includes("evil.example")), "<meta> в тексте скрипта — не тег страницы");
  const noLd = extractHtmlProduct("<title>Только title</title><meta property='og:title' content='OG &quot;кавычки&quot;'>", "https://x.example/");
  assert.equal(noLd.title, 'OG "кавычки"');
  assert.equal(extractHtmlProduct("<title>Запасной</title>", "https://x.example/").title, "Запасной");
});

test("Хранилище: пути загрузок и фото модели не выходят за свои папки", () => {
  const path = uploadPath("image/webp");
  assert.match(path, /^uploads\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}\.webp$/);
  assert.equal(isUploadPath(path), true);
  assert.equal(isUploadPath("uploads/../refs/x.jpg"), false);
  assert.equal(isUploadPath("refs/abc/def.jpg"), false);
  assert.equal(referenceMediaPath("ref-1", "ab12", "image/jpeg"), "refs/ref-1/ab12.jpg");
});

const obs = (partial: Partial<ObservationLite>): ObservationLite => ({
  group_kind: "novelty", metric: "first_seen", value_text: null, value_num: null, null_reason: null,
  status: "observed", observed_at: "2026-10-01T10:00:00Z", ...partial,
});

test("«Почему показали»: только наблюдённое, одна находка названа одной находкой", () => {
  const retail = cardSignal([obs({ group_kind: "retail", metric: "new_badge", value_text: "New Arrival", status: "retailer_claim" }),
    obs({ metric: "published_at", value_text: "2026-09-12T10:00:00+02:00", status: "retailer_claim" })], { manual: false, colors: 3 });
  assert.equal(retail.tone, "retail");
  assert.equal(retail.label, "Отмечено ритейлером: New Arrival");
  assert.equal(retail.why, "метка «New Arrival» на сайте; опубликовано 12.09.2026; 3 цвета в одной модели; пока одна находка");

  const manual = cardSignal([obs({})], { manual: true, colors: 0 });
  assert.equal(manual.tone, "manual");
  assert.equal(manual.why, "пока одна находка");

  const single = cardSignal([], { manual: false, colors: 1 });
  assert.equal(single.tone, "single");
  assert.doesNotMatch(single.why + single.label, /раст|тренд|продаж/i, "без выдуманной динамики");
});

test("Теги магазина в карточке — по-человечески, бестселлер — тоже сигнал ритейла", () => {
  assert.equal(cleanBadge("LABEL:NEW"), "NEW");
  assert.equal(cleanBadge("New Arrival"), "New Arrival");
  assert.equal(cleanBadge("bestsellers-resort"), "bestsellers resort");
  const polene = cardSignal([obs({ group_kind: "retail", metric: "new_badge", value_text: "LABEL:NEW", status: "retailer_claim" })], { manual: false, colors: 0 });
  assert.equal(polene.label, "Отмечено ритейлером: NEW");
  assert.match(polene.why, /^метка «NEW» на сайте/);
  const best = cardSignal([obs({ group_kind: "retail", metric: "bestseller_badge", value_text: "bestsellers-resort", status: "retailer_claim" })], { manual: false, colors: 0 });
  assert.equal(best.tone, "retail");
  assert.equal(best.label, "Отмечено ритейлером: бестселлер");
  assert.match(best.why, /в разделе бестселлеров на сайте/);
});

test("Склонение цветов", () => {
  assert.deepEqual([1, 2, 5, 11, 21, 22, 25].map(pluralColors), ["цвет", "цвета", "цветов", "цветов", "цвет", "цвета", "цветов"]);
});
