import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { catalogUrl, classifyItem, crawlPlan, isShopifyCrawlable, parseCatalogPage, productUrl, type CatalogItem } from "../lib/assortment/crawl.ts";
import { crawlStatus } from "../lib/assortment/coverage.ts";

/**
 * Автообход Shopify-каталогов (этап 2). Первый обход — база, а не «весь
 * каталог новинки»; цены не проходят разбор; чужое (кошельки) — не наше.
 */

const root = fileURLToPath(new URL("..", import.meta.url));
const item = (patch: Partial<CatalogItem>): CatalogItem => ({ sourceItemId: "1", handle: "h", title: "", productType: "", tags: [], publishedAt: null, ...patch });

test("Страница каталога: только ID, handle, название, тип, теги, дата — без цен и вариантов", () => {
  const items = parseCatalogPage({ products: [
    { id: 11, handle: "boky-textured-camel", title: " Boky - Textured Camel ", product_type: "Handbags", tags: ["LABEL:NEW", "family_boky"], published_at: "2026-09-15T00:00:00+02:00", variants: [{ price: "450.00" }] },
    { id: 12, title: "без handle" },
    { handle: "без id" },
  ] });
  assert.equal(items.length, 1);
  assert.deepEqual(items[0], { sourceItemId: "11", handle: "boky-textured-camel", title: "Boky - Textured Camel", productType: "Handbags", tags: ["LABEL:NEW", "family_boky"], publishedAt: "2026-09-15T00:00:00+02:00" });
  assert.doesNotMatch(JSON.stringify(items), /price|450/);
  assert.deepEqual(parseCatalogPage({ error: "x" }), []);
});

test("Раздел товара: сумки, куртки, «Shell Bag» — сумка, кошельки и ремни — не наше", () => {
  assert.equal(classifyItem(item({ productType: "Handbags", title: "Boky" }), ["bags"]), "bags");
  assert.equal(classifyItem(item({ title: "Long Jacket W3" }), ["jackets", "bags"]), "jackets");
  assert.equal(classifyItem(item({ title: "Shell Bag Large" }), ["jackets", "bags"]), "bags");
  assert.equal(classifyItem(item({ title: "Card Holder", productType: "Small leather goods" }), ["bags"]), null);
  assert.equal(classifyItem(item({ title: "Bag Strap", productType: "Accessories" }), ["bags"]), null);
  assert.equal(classifyItem(item({ title: "Long Jacket" }), ["bags"]), null, "раздел источника ограничивает");
  assert.equal(classifyItem(item({ title: "Женская сумка" }), ["bags"]), "bags", "кириллица без \\b");
  assert.equal(classifyItem(item({ title: "Mini", tags: ["category:bags"] }), ["bags"]), "bags");
});

test("Первый обход — база без новинок; дальше новые — только невиданные ID", () => {
  const fetched = [item({ sourceItemId: "1" }), item({ sourceItemId: "2" })];
  assert.deepEqual(crawlPlan(new Set(), fetched), { baseline: true, fresh: [] });
  assert.deepEqual(crawlPlan(new Set(["1"]), fetched).fresh.map((i) => i.sourceItemId), ["2"]);
  assert.deepEqual(crawlPlan(new Set(["1", "2"]), fetched).fresh, []);
});

test("Адреса каталога и карточки; обходим только проверенные Shopify-источники", () => {
  assert.equal(catalogUrl("https://eng.polene-paris.com/collections/all", 2), "https://eng.polene-paris.com/products.json?limit=250&page=2");
  assert.equal(productUrl("https://rains.com/", "long-jacket"), "https://rains.com/products/long-jacket");
  assert.equal(isShopifyCrawlable({ access_status: "auto_verified", access_note: "Shopify products.json; коллекции", seed_urls: ["https://rains.com/"] }), true);
  assert.equal(isShopifyCrawlable({ access_status: "auto_verified", access_note: "HTML /us/, атрибут data-ga", seed_urls: ["https://www.charleskeith.com/"] }), false);
  assert.equal(isShopifyCrawlable({ access_status: "manual_only", access_note: "products.json", seed_urls: ["https://x.com/"] }), false);
});

test("Пульс источника: ошибка, давность, «ещё не обходили»", () => {
  const now = Date.parse("2026-10-05T10:00:00Z");
  assert.equal(crawlStatus({ lastAttemptAt: null, lastSuccessAt: null, lastError: null }, now), null);
  const failing = crawlStatus({ lastAttemptAt: "2026-10-05T03:30:00Z", lastSuccessAt: "2026-10-03T03:30:00Z", lastError: "HTTP 429" }, now);
  assert.equal(failing?.failing, true);
  assert.match(failing?.text ?? "", /не удался .*HTTP 429; последний успешный/);
  assert.equal(crawlStatus({ lastAttemptAt: "2026-10-05T03:30:00Z", lastSuccessAt: "2026-10-05T03:30:00Z", lastError: null }, now)?.failing, false);
  assert.match(crawlStatus({ lastAttemptAt: "2026-10-01T03:30:00Z", lastSuccessAt: "2026-10-01T03:30:00Z", lastError: null }, now)?.text ?? "", /давно не запускался/);
});

test("Миграция обхода без цен; крон заведён ежедневно и отвечает на GET", () => {
  const sql = readFileSync(join(root, "supabase/migrations/202610020002_assortment_catalog_crawl.sql"), "utf8");
  const columns = sql.split("\n").filter((l) => /^\s{2}[a-z_]+\s+(text|uuid|boolean|timestamptz)/.test(l)).map((l) => l.trim().split(/\s+/)[0]);
  assert.ok(columns.length >= 10);
  for (const c of columns) assert.doesNotMatch(c, /price|cost|margin|currency|spp|moq|budget/i, c);
  assert.match(sql, /revoke all on public\.assortment_source_items from anon, authenticated/);
  const vercel = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")) as { crons: Array<{ path: string; schedule: string }> };
  assert.deepEqual(vercel.crons.filter((c) => c.path === "/api/sync/assortment-crawl"), [{ path: "/api/sync/assortment-crawl", schedule: "30 3 * * *" }]);
  assert.match(readFileSync(join(root, "app/api/sync/assortment-crawl/route.ts"), "utf8"), /export async function GET/);
});
