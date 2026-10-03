import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildEvidence, type EvidenceObservation } from "../lib/assortment/evidence.ts";
import { bestRuMatch, isRuSource, RU_SOURCE_IDS, ruDirection, wbProductUrl } from "../lib/assortment/ruMarket.ts";
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

test("Лучшее похожее на WB — самое продаваемое; без продаж — нет сигнала", () => {
  const best = bestRuMatch([
    { referenceId: "a", distance: 0.12, sales: 300, title: "A", brand: "X", url: "u1" },
    { referenceId: "b", distance: 0.25, sales: 1200, title: "B", brand: "Y", url: "u2" },
    { referenceId: "c", distance: 0.1, sales: null, title: "C", brand: "Z", url: "u3" },
  ]);
  assert.equal(best?.referenceId, "b");
  assert.equal(bestRuMatch([{ referenceId: "c", distance: 0.1, sales: null, title: "C", brand: null, url: "" }]), null);
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
