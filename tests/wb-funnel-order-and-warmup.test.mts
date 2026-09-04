import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const funnel = readFileSync(new URL("../components/wb/WbFunnelPage.tsx", import.meta.url), "utf8");
const warmup = readFileSync(new URL("../lib/wb/dashboardWarmup.ts", import.meta.url), "utf8");
const seoRoute = readFileSync(new URL("../app/api/seo/skus/route.ts", import.meta.url), "utf8");

test("Воронка применяет ручной порядок артикулов из РНП", () => {
  // Пересохранение порядка в РНП «не работало» в Воронке, потому что Воронка
  // его вообще не читала — теперь перечисленные артикулы идут первыми.
  assert.match(funnel, /useCabinetSkuOrder\(hasExactCabinet \? cabinetId : null\)/);
  assert.match(funnel, /sortByCustomSkuOrder\(base, \(sku\) => sku\.nm, orderIndex\)/);
});

test("прогрев греет все три окна воронки, дополнительные — без пересборки", () => {
  // Грелось только окно 7 дней: «Вчера» и «30 дней» пользователь всегда
  // собирал сам. refresh=1 на дополнительных окнах устроил бы полный ребилд
  // каждый час — достаточно собрать холодный снимок нового дня один раз.
  assert.match(warmup, /coldOnly\(1\)/);
  assert.match(warmup, /coldOnly\(30\)/);
  assert.match(warmup, /url\.searchParams\.delete\("refresh"\)/);
});

test("seo/skus умеет ?timings=1 и грузит страницы пачками", () => {
  assert.match(seoRoute, /params\.get\("timings"\) === "1"/);
  assert.match(seoRoute, /concurrency: 4/);
  assert.match(seoRoute, /timed\("feedbacks"/);
  // Остаток, артикул и себестоимость читаются своими запросами: тяжёлый
  // rnp_report считал вдобавок заказы и выкупы за четыре периода и стоил
  // пятнадцать секунд из двадцати четырёх на холодном снимке воронки.
  assert.doesNotMatch(seoRoute, /loadRnpReportRows/);
  assert.match(seoRoute, /timed\("stocks"/);
  assert.match(seoRoute, /timed\("cards"/);
});

test("seo/skus не выбрасывает товары с переходами в карточку", () => {
  // Товар без рекламы, заказов и остатка, но с трафиком в карточку — это ровно
  // тот случай, ради которого воронку и открывают.
  assert.match(seoRoute, /s\.open_card_window > 0 \|\| s\.cart_window > 0/);
});

test("все источники воронки читаются одной пачкой", () => {
  // Отзывы раньше грузились ПОСЛЕ основной пачки — им нужен был список nm.
  // Фильтр по кабинету снял эту зависимость, и пять секунд ожидания ушли.
  const start = seoRoute.indexOf("await Promise.all([");
  const batch = seoRoute.slice(start, seoRoute.indexOf("      ]);", start));
  for (const source of ["funnel", "adverts", "stocks", "cards", "scope", "fbs_stocks", "costs", "daily_sku", "feedbacks"]) {
    assert.ok(batch.includes(`timed("${source}"`), `источник ${source} читается вне общей пачки`);
  }
});

test("артикул воронки берётся из карточек WB, а не только из товарного контура", () => {
  // Товарный контур заполнен лишь у кабинетов с ограничением по бренду: у
  // внешнего продавца он пуст, и опора только на него оставила бы вместо
  // артикулов голые номера nm по всему кабинету.
  assert.match(seoRoute, /\.from\("wb_cards"\)/);
  assert.match(seoRoute, /for \(const row of \[\.\.\.cards, \.\.\.scope\]\)/);
});

test("ДРР за период без рекламы не выдаётся за ноль", () => {
  // На боевом кабинете так «нулевой ДРР» стоял у 84 товаров, которые вообще не
  // рекламировались, — включая тот, что принёс 766 тысяч заказов.
  assert.match(seoRoute, /hasAd: views > 0 \|\| spent > 0/);
  assert.match(seoRoute, /const drr = \(a: typeof w\) => \(a\.hasAd \? pct\(a\.spent, a\.os\) : null\)/);
  assert.doesNotMatch(seoRoute, /drr7 = pct\(w\.spent, w\.os\)/);
});

test("«Сначала рабочие» поднимает только то, по чему экран покажет CTR", () => {
  const page = readFileSync(new URL("../components/wb/WbFunnelPage.tsx", import.meta.url), "utf8");
  // Первая версия поднимала всё, где показов больше нуля. На боевом кабинете
  // из 133 поднятых артикулов у 70 было от одного до десяти показов за день —
  // колонка такие доли прячет, и наверху вставала стена прочерков.
  assert.doesNotMatch(page, /\?\.views \?\? 0\) > 0/, "порог поднятия ниже порога достоверности CTR");
  const uses = page.match(/\?\.views \?\? 0\) >= CTR_MIN_VIEWS/g) ?? [];
  assert.equal(uses.length, 2, "порог применён не и к сортировке, и к счётчику на кнопке");
});
