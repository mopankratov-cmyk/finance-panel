import assert from "node:assert/strict";
import test from "node:test";
import { loadFeed } from "../lib/assortment/feed.ts";

/** Лента находок: «Рынок РФ» сортируется по продажам среди ВСЕГО замера, чтение наблюдений/фото — пачками, с листанием и без проглоченных ошибок (05.10). */

type Row = Record<string, unknown>;

function fakeDb(tables: Record<string, Row[]>, opts: { failTable?: string; inSizes?: number[]; maxRows?: number } = {}) {
  const maxRows = opts.maxRows ?? 1000;
  return {
    from: (table: string) => {
      const preds: Array<(r: Row) => boolean> = [];
      const sorts: Array<[string, boolean]> = [];
      let cap = Infinity;
      const sorted = () => {
        let list = (tables[table] ?? []).filter((r) => preds.every((p) => p(r)));
        for (const [col, asc] of sorts.slice().reverse()) list = list.slice().sort((a, b) => (String(a[col] ?? "") < String(b[col] ?? "") ? -1 : String(a[col] ?? "") > String(b[col] ?? "") ? 1 : 0) * (asc ? 1 : -1));
        return list;
      };
      const failure = () => (opts.failTable === table ? { message: "statement timeout" } : null);
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (c: string, v: unknown) => { preds.push((r) => r[c] === v); return q; },
        in: (c: string, v: unknown[]) => { if (c === "reference_id") opts.inSizes?.push(v.length); preds.push((r) => v.includes(r[c])); return q; },
        not: (c: string, op: string, v: unknown) => {
          if (op === "is") preds.push((r) => (r[c] ?? null) !== v);
          else if (op === "in") { const list = String(v).replace(/[()]/g, "").split(","); preds.push((r) => !list.includes(String(r[c]))); }
          return q;
        },
        or: (expr: string) => {
          const list = /not\.in\.\(([^)]*)\)/.exec(expr)?.[1].split(",") ?? [];
          preds.push((r) => r.source_id == null || !list.includes(String(r.source_id)));
          return q;
        },
        gte: (c: string, v: unknown) => { preds.push((r) => String(r[c] ?? "") >= String(v)); return q; },
        order: (c: string, o?: { ascending?: boolean }) => { sorts.push([c, o?.ascending !== false]); return q; },
        limit: (n: number) => { cap = n; return q; },
        range: (from: number, to: number) => Promise.resolve(failure() ? { data: null, error: failure() } : { data: sorted().slice(from, Math.min(to, from + maxRows - 1) + 1), error: null }),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(failure() ? { data: null, error: failure() } : { data: sorted().slice(0, cap), error: null }).then(resolve),
      };
      return q;
    },
  } as never;
}

const ref = (i: number, over: Row = {}): Row => ({
  id: `r${String(i).padStart(4, "0")}`, title: `WB jacket ${i}`, brand: null, region: "RU", url: `https://wb/${i}`, first_seen_at: new Date(Date.UTC(2026, 9, 1) + i * 60_000).toISOString(),
  status: "new", version: 1, attributes: {}, source_id: "S128", updated_at: "2026-10-05T00:00:00Z", direction: "jackets", ...over,
});
const sales = (i: number, n: number): Row => ({ id: `o${i}`, reference_id: `r${String(i).padStart(4, "0")}`, group_kind: "retail", metric: "wb_sales_30d", value_text: null, value_num: n, null_reason: null, status: "provider_estimate", method: "mpstats", observed_at: "2026-10-05T00:00:00Z" });

test("Вкладка «Рынок РФ»: первым то, что больше продаётся, среди ВСЕГО замера, а не среди 60 самых новых позиций", async () => {
  // 150 позиций; лучшие продавцы — самые СТАРЫЕ (в первый замер позиции вставляются в порядке «топ по продажам», новые — хвост).
  const refs = Array.from({ length: 150 }, (_, i) => ref(i));
  const observations = refs.map((_, i) => sales(i, (150 - i) * 10));
  const db = fakeDb({ assortment_references: refs, assortment_observations: observations, assortment_media: [], assortment_decisions: [] });
  const cards = await loadFeed(db, "jackets", "ru", 10);
  assert.equal(cards.length, 10);
  assert.deepEqual(cards.map((c) => c.id), Array.from({ length: 10 }, (_, i) => `r${String(i).padStart(4, "0")}`), "лучшие 10 по продажам — самые старые позиции, они не выпали из окна новизны");
});

test("Лента: сбой чтения наблюдений или фото — ошибка, а не «наблюдений нет» (иначе «Пока одна находка» у всех карточек и пустой «Ритейл»)", async () => {
  const refs = [ref(1, { source_id: "S001" })];
  for (const failTable of ["assortment_observations", "assortment_media"]) {
    const db = fakeDb({ assortment_references: refs, assortment_observations: [], assortment_media: [], assortment_decisions: [] }, { failTable });
    await assert.rejects(() => loadFeed(db, "jackets", "new", 10), /statement timeout/, failTable);
  }
});

test("Лента: «Ритейл» читает наблюдения пачками по 100 находок и листает ответ дальше тысячи строк", async () => {
  const refs = Array.from({ length: 250 }, (_, i) => ref(i, { source_id: "S001" }));
  // 250 находок × 15 наблюдений: в одной пачке из 100 находок — 1500 строк (больше предела PostgREST 1000), без листания хвост терялся бы;
  // у каждой — «бейдж ритейлера», чтобы попасть во вкладку.
  const observations: Row[] = [];
  refs.forEach((_, i) => {
    for (let k = 0; k < 14; k += 1) observations.push({ id: `o${i}-${k}`, reference_id: `r${String(i).padStart(4, "0")}`, group_kind: "novelty", metric: `m${k}`, value_text: "x", value_num: null, null_reason: null, status: "observed", method: "crawl", observed_at: "2026-10-05T00:00:00Z" });
    observations.push({ id: `o${i}-badge`, reference_id: `r${String(i).padStart(4, "0")}`, group_kind: "retail", metric: "new_badge", value_text: "New", value_num: null, null_reason: null, status: "retailer_claim", method: "crawl", observed_at: "2026-10-05T00:00:00Z" });
  });
  const inSizes: number[] = [];
  const db = fakeDb({ assortment_references: refs, assortment_observations: observations, assortment_media: [], assortment_decisions: [] }, { inSizes });
  const cards = await loadFeed(db, "jackets", "retail", 300);
  assert.ok(inSizes.length >= 6, "наблюдения и фото — несколькими запросами (по 100 id)");
  assert.ok(Math.max(...inSizes) <= 100, `в одном .in() не больше 100 id (было ${Math.max(...inSizes)})`);
  assert.equal(cards.length, 250, "все 250 находок с бейджем попали во вкладку: ни одна не потерялась на границе 1000 строк");
});
