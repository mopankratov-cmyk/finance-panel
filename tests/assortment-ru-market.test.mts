import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildEvidence, type EvidenceObservation } from "../lib/assortment/evidence.ts";
import { closestRuMatch, isRuSource, matchesShape, RU_SOURCE_IDS, ruDirection, shapeStems, wbProductUrl } from "../lib/assortment/ruMarket.ts";
import { cardSignal } from "../lib/assortment/signals.ts";
import { latestSales, learnFromRuMarket, storeAll } from "../lib/assortment/ruMarketStore.ts";

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
  assert.deepEqual(shapeStems("jackets", { subtype: "жакет" }), ["жакет", "пиджак", "блейзер"]);
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

// --- чтения без потолка 1000 и без проглоченных ошибок (аудит 05.10) ---

type Row = Record<string, unknown>;
function pagedDb(tables: Record<string, Row[]>, opts: { failTable?: string; rpcError?: boolean } = {}) {
  const calls = { deleted: 0, inSizes: [] as number[] };
  const db = {
    from: (table: string) => {
      const preds: Array<(r: Row) => boolean> = [];
      let del = false;
      const rows = () => (tables[table] ?? []).filter((r) => preds.every((p) => p(r)));
      const failure = () => (opts.failTable === table ? { message: "statement timeout" } : null);
      const q: Record<string, unknown> = {
        select: () => q, order: () => q,
        not: () => q, neq: () => q,
        eq: (c: string, v: unknown) => { preds.push((r) => r[c] === v); return q; },
        in: (c: string, v: unknown[]) => { if (c === "id" || c === "reference_id") calls.inSizes.push(v.length); preds.push((r) => v.includes(r[c])); return q; },
        delete: () => { del = true; return q; },
        range: (from: number, to: number) => Promise.resolve(failure() ? { data: null, error: failure() } : { data: rows().slice(from, Math.min(to, from + 999) + 1), error: null }),
        then: (resolve: (v: unknown) => unknown) => {
          if (del) calls.deleted += 1;
          return Promise.resolve(failure() ? { data: null, error: failure() } : { data: rows(), error: null }).then(resolve);
        },
      };
      return q;
    },
    rpc: () => Promise.resolve(opts.rpcError ? { data: null, error: { message: "rpc timeout" } } : { data: [], error: null }),
  };
  return { db: db as never, calls };
}

test("«Учимся у рынка»: эмбеддинги читаются ВСЕ (а не первая тысяча), находки — пачками по 100 с проверкой ошибки; сбой поиска похожих не стирает прежний вывод", async () => {
  const refs = Array.from({ length: 1500 }, (_, i) => ({ id: `r${String(i).padStart(5, "0")}`, source_id: "S001", title: `Bag ${i}`, brand: null, url: `https://x/${i}`, direction: "bags", status: "new", attributes: {} }));
  const embeddings = refs.map((r, i) => ({ media_id: `m${String(i).padStart(5, "0")}`, reference_id: r.id, embedding: "[]" }));
  const { db, calls } = pagedDb({ assortment_media_embeddings: embeddings, assortment_references: refs, assortment_observations: [] });
  const out = await learnFromRuMarket(db, Date.now() + 60_000);
  assert.equal(out.checked, 1500, "проверены все зарубежные находки, а не 1000");
  assert.ok(calls.inSizes.length >= 15 && Math.max(...calls.inSizes) <= 100, `находки читались пачками (${calls.inSizes.length} запросов, максимум ${Math.max(...calls.inSizes)} id)`);
  // Сбой чтения находок — исключение, а не «0 проверено».
  await assert.rejects(() => learnFromRuMarket(pagedDb({ assortment_media_embeddings: embeddings, assortment_references: refs }, { failTable: "assortment_references" }).db, Date.now() + 60_000), /statement timeout/);
  // Сбой rpc «похожие»: находка непроверена (failed), прежний вывод ru_similar_sales НЕ удаляется.
  const shaped = [{ ...refs[0], attributes: { silhouette: { value: "тоут", origin: "ai_estimate" } } }];
  const flaky = pagedDb({ assortment_media_embeddings: [embeddings[0]], assortment_references: shaped, assortment_observations: [] }, { rpcError: true });
  const result = await learnFromRuMarket(flaky.db, Date.now() + 60_000);
  assert.deepEqual(result, { checked: 1, matched: 0, failed: 1 });
  assert.equal(flaky.calls.deleted, 0, "прежний сигнал на месте");
});

test("Продажи позиций рынка: сбой чтения — исключение (иначе «продаж нет» у всех и в архив уходит весь замер); читается пачками и дальше тысячи строк", async () => {
  const ids = Array.from({ length: 250 }, (_, i) => `r${String(i).padStart(4, "0")}`);
  const observations = ids.flatMap((id, i) => Array.from({ length: 6 }, (_, k) => ({ id: `o${i}-${k}`, reference_id: id, metric: "wb_sales_30d", value_num: (i + 1) * 10 + k, observed_at: `2026-09-${String(10 + k).padStart(2, "0")}T00:00:00Z` })));
  const { db, calls } = pagedDb({ assortment_observations: observations });
  const sales = await latestSales(db, ids);
  assert.equal(sales.size, 250, "продажи прочитаны у всех 250 позиций (1500 строк > предела 1000)");
  assert.equal(sales.get("r0000"), 15, "берётся последний замер");
  assert.ok(Math.max(...calls.inSizes) <= 100);
  await assert.rejects(() => latestSales(pagedDb({ assortment_observations: observations }, { failTable: "assortment_observations" }).db, ids), /statement timeout/);
});

test("Запись замера: не записалась ни одна позиция — это ошибка с причиной, а не «собрано 30»; частичный сбой назван с числом", async () => {
  const item = (id: number) => ({ id, name: `Куртка ${id}`, brand: "X", subject: "Куртки", color: null, sales: 100, comments: 5, rating: 4.5, firstDate: null });
  const picks = Array.from({ length: 3 }, (_, i) => ({ direction: "jackets" as const, item: item(i + 1) }));
  const fakeDb = (failInsertFor: number[]) => ({
    from: (table: string) => {
      let dedup = "";
      const q: Record<string, unknown> = {
        select: () => q, update: () => q, eq: (c: string, v: string) => { if (c === "dedup_key") dedup = v; return q; },
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        insert: (row: Record<string, unknown>) => {
          if (table === "assortment_references") {
            const n = Number(row.article);
            q.single = () => Promise.resolve(failInsertFor.includes(n) ? { data: null, error: { message: "duplicate key value" } } : { data: { id: `ref${n}` }, error: null });
          }
          return q;
        },
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
      };
      void dedup;
      return q;
    },
  }) as never;
  const none = await storeAll(fakeDb([1, 2, 3]), "S128", picks, "mpstats_top", Date.now() + 60_000, { added: 0 });
  assert.equal(none.added + none.updated, 0);
  assert.equal(none.failed, 3);
  assert.match(none.error ?? "", /не записалась ни одна из 3 позиций: duplicate key value/);
  const some = await storeAll(fakeDb([2]), "S128", picks, "mpstats_top", Date.now() + 60_000, { added: 0 });
  assert.equal(some.added, 2);
  assert.equal(some.failed, 1);
  assert.match(some.error ?? "", /не записалось 1 из 3 позиций/);
  const clean = await storeAll(fakeDb([]), "S128", picks, "mpstats_top", Date.now() + 60_000, { added: 0 });
  assert.equal(clean.error, undefined, "без сбоев ошибки нет");
});
