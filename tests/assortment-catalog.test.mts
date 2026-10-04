import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { brandStats, catalogFiltersFrom, catalogProductUrl, ilikePattern, parseCatalogQuery, resolvePhotoMode, sectionViewFrom, thumbUrl, toCatalogCard, type CatalogRow } from "../lib/assortment/catalog.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const NOW = Date.parse("2026-10-04T12:00:00Z");

test("Фильтры каталога: бренд, поиск, новое, метки, без фото, порции — с пределами", () => {
  const q = parseCatalogQuery(new URLSearchParams("source=S131&q=  кожаная   сумка &fresh=1&badge=1&photo=all&offset=96&limit=500"), "bags");
  assert.deepEqual(q, { direction: "bags", sourceId: "S131", search: "кожаная сумка", fresh: true, badge: true, photo: "all", offset: 96, limit: 96 });
  const d = parseCatalogQuery(new URLSearchParams("source=../x&q=a&offset=-5"), "jackets");
  assert.equal(d.sourceId, null, "чужой номер источника не проходит");
  assert.equal(d.search, null, "одна буква — не поиск");
  assert.equal(d.offset, 0);
  assert.equal(d.limit, 48);
  assert.equal(d.photo, "auto", "по умолчанию решает сервер по доле моделей с фото");
  assert.equal(parseCatalogQuery(new URLSearchParams("photo=with"), "bags").photo, "with", "явный выбор «только с фото» запоминается");
});

test("Поиск: свои % и _ не работают как шаблон, запятые и скобки не ломают фильтр", () => {
  assert.equal(ilikePattern("50%_off"), "%50\\%\\_off%");
  assert.equal(ilikePattern("bag, (mini)"), "%bag   mini %");
});

test("Превью ~480 px по правилам CDN; только https", () => {
  assert.equal(thumbUrl("https://cdn.shopify.com/s/files/1/boky.jpg?v=1"), "https://cdn.shopify.com/s/files/1/boky.jpg?v=1&width=480");
  assert.equal(thumbUrl("https://eng.polene-paris.com/cdn/shop/files/a.jpg?v=2"), "https://eng.polene-paris.com/cdn/shop/files/a.jpg?v=2&width=480");
  assert.equal(thumbUrl("https://images.asos-media.com/products/x/1-1?$n_1920w$&wid=1200&fit=constrain"), "https://images.asos-media.com/products/x/1-1?$n_480w$&wid=480&fit=constrain");
  assert.equal(thumbUrl("https://image.hm.com/assets/hm/a.jpg?imwidth=1200"), "https://image.hm.com/assets/hm/a.jpg?imwidth=480");
  assert.equal(thumbUrl("https://image.uniqlo.com/UQ/ST3/eu/a.jpg?width=1200"), "https://image.uniqlo.com/UQ/ST3/eu/a.jpg?width=480");
  assert.equal(thumbUrl("https://a.cdn.lime-shine.com/p/x.jpeg?w=1200&q=85"), "https://a.cdn.lime-shine.com/p/x.jpeg?w=480&q=85");
  assert.equal(thumbUrl("https://imgcdn.befree.ru/rest/V1/images/1280/product/images/BF1/BF1_20_1.jpg"), "https://imgcdn.befree.ru/rest/V1/images/640/product/images/BF1/BF1_20_1.jpg");
  assert.equal(thumbUrl("https://imgcdn.zarina.ru/upload/images/zr261/thumb/900_9999/a.webp"), "https://imgcdn.zarina.ru/upload/images/zr261/thumb/600_9999/a.webp");
  assert.equal(thumbUrl("https://imgcdn.loverepublic.ru/upload/images/64492/644920065_22_4.jpg"), "https://imgcdn.loverepublic.ru/upload/images/64492/thumb/600_9999/644920065_22_4.jpg");
  assert.equal(thumbUrl("https://cdn01.sela.ru/wa-data/public/shop/products/44/98/219844/images/982985/982985.671x936@2x.jpg"), "https://cdn01.sela.ru/wa-data/public/shop/products/44/98/219844/images/982985/982985.671x936.jpg");
  assert.equal(thumbUrl("https://askent.ru/upload/resize_cache/iblock/254/900_1095_1/a.webp"), "https://askent.ru/upload/resize_cache/iblock/254/900_1095_1/a.webp", "незнакомый CDN — как есть");
  assert.equal(thumbUrl("http://insecure/a.jpg"), null);
  assert.equal(thumbUrl("javascript:alert(1)"), null);
});

test("Ссылка на товар: у Shopify slug + адрес сайта, у остальных полный адрес; чужие схемы — нет", () => {
  assert.equal(catalogProductUrl("boky-camel", "https://eng.polene-paris.com/collections/all"), "https://eng.polene-paris.com/products/boky-camel");
  assert.equal(catalogProductUrl("https://befree.ru/zhenskaya/product/BF1/20", null), "https://befree.ru/zhenskaya/product/BF1/20");
  assert.equal(catalogProductUrl("javascript:alert(1)", null), null);
  assert.equal(catalogProductUrl(null, "https://x"), null);
});

const row = (patch: Partial<CatalogRow>): CatalogRow => ({
  source_id: "S131", source_item_id: "BF1", handle: "https://befree.ru/zhenskaya/product/BF1/20", title: "Сумка", product_type: "", first_seen_at: "2026-10-03T21:48:00Z",
  last_seen_at: "2026-10-03T21:48:00Z", baseline: true, reference_id: null, image_urls: ["https://imgcdn.befree.ru/rest/V1/images/1280/product/images/BF1/BF1_20_1.jpg"], brand: "befree", badges: null, ...patch,
});

test("Карточка каталога: бренд, превью, «новинка» — только после базы и за 7 дней, без цен", () => {
  const base = toCatalogCard(row({}), { name: "befree", seedUrl: null }, NOW);
  assert.equal(base.isNew, false, "модель из базы — не новинка");
  assert.equal(base.images[0], "https://imgcdn.befree.ru/rest/V1/images/640/product/images/BF1/BF1_20_1.jpg");
  assert.equal(toCatalogCard(row({ baseline: false, first_seen_at: "2026-10-02T00:00:00Z" }), undefined, NOW).isNew, true);
  assert.equal(toCatalogCard(row({ baseline: false, first_seen_at: "2026-09-20T00:00:00Z" }), undefined, NOW).isNew, false, "старше 7 дней");
  const noBrand = toCatalogCard(row({ brand: null, image_urls: null, badges: ["new", "sale"] }), { name: "Love Republic", seedUrl: null }, NOW);
  assert.equal(noBrand.brand, "Love Republic");
  assert.deepEqual(noBrand.images, []);
  assert.deepEqual(noBrand.badges, ["new"], "незнакомые метки отбрасываются");
  assert.doesNotMatch(JSON.stringify(base), /price|₽|cost/i);
});

test("Чипы брендов: только раздел и только непустые, крупные первыми", () => {
  const stats = brandStats([
    { source_id: "S131", direction: "bags", models: 202, with_photo: 200, new_7d: 3 },
    { source_id: "S133", direction: "bags", models: 32, with_photo: 32, new_7d: 0 },
    { source_id: "S131", direction: "jackets", models: 271, with_photo: 271, new_7d: 0 },
    { source_id: "S999", direction: "bags", models: 0, with_photo: 0, new_7d: 0 },
  ], "bags", new Map([["S131", "befree"], ["S133", "ZARINA"]]));
  assert.deepEqual(stats.map((s) => `${s.name}:${s.models}`), ["befree:202", "ZARINA:32"]);
});

test("Роуты каталога: под сессией модуля; фото — адрес только из базы, без сохранения", () => {
  const api = readFileSync(join(root, "app/api/assortment-development/catalog/route.ts"), "utf8");
  assert.match(api, /requireApiSession\(ASSORTMENT_ROLES\)/);
  const photo = readFileSync(join(root, "app/api/assortment-development/catalog/photo/route.ts"), "utf8");
  assert.match(photo, /requireApiSession\(ASSORTMENT_ROLES\)/);
  assert.match(photo, /catalogImageUrl\(db, source, item, index\)/, "адрес — из строки обхода");
  assert.doesNotMatch(photo, /searchParams\.get\("url"\)/, "адрес из запроса не принимается");
  assert.doesNotMatch(photo, /storeImages|storage\.from/, "ничего не сохраняем");
  assert.match(photo, /safeFetch\(url/);
});

test("Режим фото: выбор человека главнее; «auto» — с фото, только если фото есть хотя бы у половины", () => {
  const stats = [
    { sourceId: "S131", name: "befree", models: 400, withPhoto: 390, new7d: 0 },
    { sourceId: "S136", name: "Askent", models: 50, withPhoto: 0, new7d: 0 },
  ];
  assert.equal(resolvePhotoMode("all", stats, null), "all");
  assert.equal(resolvePhotoMode("with", stats, "S136"), "with", "явное «только с фото» не перебиваем");
  assert.equal(resolvePhotoMode("auto", stats, null), "with", "390 из 450 с фото");
  assert.equal(resolvePhotoMode("auto", stats, "S136"), "all", "у выбранного бренда фото нет — показываем без фото, а не пустой экран");
  assert.equal(resolvePhotoMode("auto", null, null), "all", "счётчиков нет (до миграции) — всё");
});

test("Вид и фильтры из адреса: только известные значения", () => {
  assert.equal(sectionViewFrom({ view: "catalog" }), "catalog");
  assert.equal(sectionViewFrom({ view: "evil" }), "new");
  assert.equal(sectionViewFrom({ view: ["catalog", "x"] }), "new", "массив параметров — не наш случай");
  assert.deepEqual(catalogFiltersFrom({ source: "S131", q: "сумка", fresh: "1", photo: "with" }), { source: "S131", q: "сумка", fresh: true, badge: false, photo: "with" });
  assert.deepEqual(catalogFiltersFrom({ source: "../x", photo: "evil" }), { source: null, q: "", fresh: false, badge: false, photo: "auto" });
});

test("Экран каталога: начальный вид — с сервера (без мигания «Новинок»), вкладка в конце ряда, прокрутка не теряется", () => {
  const page = readFileSync(join(root, "app/assortment-development/bags/page.tsx"), "utf8");
  assert.match(page, /await searchParams/);
  assert.match(page, /initialView=\{view\}/);
  const section = readFileSync(join(root, "components/assortment/AssortmentSection.tsx"), "utf8");
  assert.match(section, /useState<SectionView>\(initialView\)/);
  assert.match(section, /\.\.\.VIEWS,\s*\.\.\.\(catalogTotal \|\| view === "catalog"/, "вкладка каталога — в конце, не сдвигает остальные");
  assert.match(section, /count=1/, "для вкладки — только число, без строк");
  const view = readFileSync(join(root, "components/assortment/CatalogView.tsx"), "utf8");
  assert.match(view, /if \(gen !== generation\.current\) return;/, "ответ «Показать ещё» от старых фильтров отбрасывается");
  assert.match(view, /const sentinel = useCallback\(\(node: HTMLDivElement \| null\)/, "наблюдатель вешается на сам элемент — и после пустого результата");
  assert.match(view, /aria-pressed=/);
  assert.doesNotMatch(view, /useSearchParams/, "без границы Suspense в пререндере");
});

test("Число для вкладки — обычным запросом, не HEAD: до миграции ошибка «нет колонки» должна прийти с текстом", () => {
  const store = readFileSync(join(root, "lib/assortment/catalogStore.ts"), "utf8");
  assert.doesNotMatch(store, /head: ?true|head \}/, "HEAD-запрос теряет текст ошибки — откат не сработает");
  assert.match(store, /const one = \{ \.\.\.query, offset: 0, limit: 1 \}/);
});

test("Число моделей склоняется: «2 334 модели», «1 447 моделей», «21 модель»", async () => {
  const { plural } = await import("../lib/warehouse/plural.ts");
  assert.equal(plural(2334, "модель", "модели", "моделей"), "модели");
  assert.equal(plural(1447, "модель", "модели", "моделей"), "моделей");
  assert.equal(plural(21, "модель", "модели", "моделей"), "модель");
  for (const file of ["components/assortment/AssortmentSection.tsx", "components/assortment/CatalogView.tsx"]) {
    assert.doesNotMatch(readFileSync(join(root, file), "utf8"), /toLocaleString\("ru-RU"\)\} моделей/, `${file}: число без склонения`);
  }
});
