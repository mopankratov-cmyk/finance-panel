import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildEvidence, type EvidenceObservation } from "../lib/assortment/evidence.ts";
import { closestRuMatch, isRuSource, matchesShape, RU_SOURCE_IDS, ruDirection, shapeStems, wbProductUrl } from "../lib/assortment/ruMarket.ts";
import { cardSignal } from "../lib/assortment/signals.ts";

/** «Рынок РФ»: топ WB и Lime на WB по MPSTATS, без цен; учимся по похожему. */

const root = fileURLToPath(new URL("..", import.meta.url));
const obs = (p: Partial<EvidenceObservation>): EvidenceObservation => ({
  group_kind: "retail", metric: "wb_sales_30d", value_text: null, value_num: null, null_reason: null, status: "provider_estimate",
  method: "mpstats_top", region: null, source_url: null, observed_at: "2026-10-05T04:00:00Z", ...p,
});

test("Раздел товара WB: сумки и верхняя одежда; кошельки и платья — нет", () => {
  assert.equal(ruDirection("Сумки", "Сумка через плечо кожаная"), "bags");
  assert.equal(ruDirection("Куртки", "Бомбер оверсайз"), "jackets");
  assert.equal(ruDirection("Пуховики", "Пуховик длинный"), "jackets");
  assert.equal(ruDirection("Кошельки", "Кошелёк кожаный"), null);
  assert.equal(ruDirection("Платья", "Платье миди"), null);
  assert.equal(ruDirection(null, "Тренч двубортный"), "jackets");
  assert.equal(wbProductUrl(123456), "https://www.wildberries.ru/catalog/123456/detail.aspx");
  assert.ok(isRuSource("S128") && isRuSource("S129") && !isRuSource("S024") && !isRuSource(null));
});

test("Похожее на WB — той же формы и самое близкое по фото, а не самый продаваемый тоут", () => {
  const stems = shapeStems("bags", { silhouette: "кросс-боди" });
  assert.ok(stems.includes("кросс-боди"));
  const candidates = [
    { referenceId: "tote", distance: 0.05, sales: 4903, title: "Сумка большая тоут шоппер", brand: "BAGYbgs", url: "u1" },
    { referenceId: "cb-far", distance: 0.22, sales: 1706, title: "Сумка кросс-боди через плечо", brand: "MILARA", url: "u2" },
    { referenceId: "cb-near", distance: 0.09, sales: 300, title: "Сумка кроссбоди маленькая", brand: "X", url: "u3" },
  ];
  assert.equal(closestRuMatch(candidates, stems)?.referenceId, "cb-near");
  assert.equal(closestRuMatch(candidates, []), null, "без формы — без сигнала");
  assert.equal(closestRuMatch(candidates, shapeStems("bags", { silhouette: "клатч" })), null, "клатча нет — честно ничего");
  assert.deepEqual(shapeStems("jackets", { subtype: "Бомбер" }), ["бомбер"]);
  assert.deepEqual(shapeStems("bags", { silhouette: "не видно" }), []);
  assert.ok(matchesShape(["тоут", "шоппер", "шопер"], "Сумка-шопер замшевая"));
});

test("Карточка WB: «Продаётся на WB», свежий замер, без «пока одна находка»", () => {
  const signal = cardSignal([
    obs({ value_num: 800, observed_at: "2026-10-05T04:00:00Z" }),
    obs({ value_num: 1234, observed_at: "2026-10-12T04:00:00Z" }),
    obs({ metric: "reviews_count", value_num: 512 }),
  ], { manual: false, colors: 0 });
  assert.equal(signal.label, "Продаётся на WB");
  assert.match(signal.why, /продаж на WB за 30 дней: 1\s234 \(оценка MPSTATS\)/);
  assert.match(signal.why, /отзывов на WB: 512/);
  assert.doesNotMatch(signal.why, /пока одна находка/);
});

test("Зарубежная находка: «на WB похожее продаётся» в объяснении и доказательствах", () => {
  const ruSimilar = obs({ group_kind: "spread", metric: "ru_similar_sales", value_num: 950, value_text: "LIME · Сумка хобо", method: "mpstats_similar", source_url: "https://www.wildberries.ru/catalog/1/detail.aspx" });
  const signal = cardSignal([ruSimilar], { manual: false, colors: 0 });
  assert.match(signal.why, /на WB похожее продаётся: 950 шт за 30 дней/);
  const evidence = buildEvidence([ruSimilar], 2);
  const row = evidence.spread.find((r) => r.label === "Похожее продаётся на WB (30 дней)");
  assert.equal(row?.value, "950 шт — LIME · Сумка хобо");
  assert.match(row?.detail ?? "", /MPSTATS \+ сходство по фото · оценка поставщика данных/);
  assert.ok(evidence.spread.some((r) => r.label === "Независимые публикации"), "заглушка соцсетей не пропала");
});

test("Без цен: клиент MPSTATS не отдаёт цены и выручку; ИИ и лента разводят рынок РФ", () => {
  const client = readFileSync(join(root, "lib/mpstats/client.ts"), "utf8");
  const mapper = client.slice(client.indexOf("function toMarketItem"), client.indexOf("const TOP_BY_SALES"));
  assert.doesNotMatch(mapper, /price|revenue|lost_profit/);
  assert.match(readFileSync(join(root, "lib/assortment/aiAttributesStore.ts"), "utf8"), /source_id\.not\.in/);
  assert.match(readFileSync(join(root, "lib/assortment/feed.ts"), "utf8"), /view === "ru"/);
  assert.deepEqual(RU_SOURCE_IDS, ["S128", "S129"]);
  const vercel = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")) as { crons: Array<{ path: string; schedule: string }> };
  assert.deepEqual(vercel.crons.filter((c) => c.path === "/api/sync/assortment-ru-market"), [{ path: "/api/sync/assortment-ru-market", schedule: "0 4 * * 1" }]);
});

test("Без продаж — не ориентир: нулевые позиции не берём; вкладка — по продажам", () => {
  const store = readFileSync(join(root, "lib/assortment/ruMarketStore.ts"), "utf8");
  assert.match(store, /export function sellingOnly/);
  assert.match(store, /archiveNotSelling/);
  assert.match(readFileSync(join(root, "lib/assortment/feed.ts"), "utf8"), /view === "ru"\) \{[\s\S]*wb_sales_30d/);
});

test("Еженедельные замеры в доказательствах — последний и «было», без повторов", () => {
  const evidence = buildEvidence([
    obs({ value_num: 800, observed_at: "2026-10-05T04:00:00Z" }),
    obs({ value_num: 1234, observed_at: "2026-10-12T04:00:00Z" }),
  ], null);
  const rows = evidence.retail.filter((r) => r.label === "Продажи на WB за 30 дней");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].value, "1 234 шт");
  assert.match(rows[0].detail, /было 800 \(05\.10\.2026\)/);
});
