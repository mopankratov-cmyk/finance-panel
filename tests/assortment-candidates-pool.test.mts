import assert from "node:assert/strict";
import test from "node:test";
import { pendingForAi } from "../lib/assortment/aiAttributesStore.ts";
import { loadCandidates } from "../lib/assortment/collectionsStore.ts";

/** Пулы выборок: кандидаты в подборку не теряют выбранное человеком, очередь ИИ-разбора не голодает у находок без фото (аудит 05.10). */

type Row = Record<string, unknown>;

function fakeDb(tables: Record<string, Row[]>, inSizes: number[] = []) {
  return {
    from: (table: string) => {
      const preds: Array<(r: Row) => boolean> = [];
      const sorts: Array<[string, boolean]> = [];
      let cap = Infinity;
      const list = () => {
        let rows = (tables[table] ?? []).filter((r) => preds.every((p) => p(r)));
        for (const [c, asc] of sorts.slice().reverse()) rows = rows.slice().sort((a, b) => (String(a[c] ?? "") < String(b[c] ?? "") ? -1 : String(a[c] ?? "") > String(b[c] ?? "") ? 1 : 0) * (asc ? 1 : -1));
        return rows;
      };
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (c: string, v: unknown) => { preds.push((r) => r[c] === v); return q; },
        neq: (c: string, v: unknown) => { preds.push((r) => r[c] !== v); return q; },
        is: (c: string, v: unknown) => { preds.push((r) => (c.startsWith("attributes->") ? !(((r.attributes ?? {}) as Row)[c.slice("attributes->".length)]) : (r[c] ?? null) === v)); return q; },
        in: (c: string, v: unknown[]) => { if (c === "reference_id" || c === "id") inSizes.push(v.length); preds.push((r) => v.includes(r[c])); return q; },
        gte: (c: string, v: unknown) => { preds.push((r) => String(r[c] ?? "") >= String(v)); return q; },
        not: (c: string, op: string, v: unknown) => {
          if (op === "in") { const set = String(v).replace(/[()]/g, "").split(","); preds.push((r) => !set.includes(String(r[c]))); }
          else if (op === "is") preds.push((r) => (r[c] ?? null) !== v);
          return q;
        },
        or: (expr: string) => {
          const set = /not\.in\.\(([^)]*)\)/.exec(expr)?.[1].split(",") ?? [];
          preds.push((r) => r.source_id == null || !set.includes(String(r.source_id)));
          return q;
        },
        order: (c: string, o?: { ascending?: boolean }) => { sorts.push([c, o?.ascending !== false]); return q; },
        limit: (n: number) => { cap = n; return q; },
        range: (a: number, b: number) => Promise.resolve({ data: list().slice(a, b + 1), error: null }),
        maybeSingle: () => Promise.resolve({ data: list()[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: list().slice(0, cap), error: null }).then(resolve),
      };
      return q;
    },
    storage: { from: () => ({ createSignedUrls: () => Promise.resolve({ data: [], error: null }) }) },
  } as never;
}

const ref = (id: string, over: Row = {}): Row => ({ id, title: `Bag ${id}`, brand: null, status: "new", attributes: {}, source_id: "S001", direction: "bags", first_seen_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", ...over });

test("Кандидаты в подборку: выбранное человеком (selected/sample_needed) старше 200 новейших находок всё равно в списке", async () => {
  const recent = Array.from({ length: 260 }, (_, i) => ref(`new${String(i).padStart(3, "0")}`, { first_seen_at: new Date(Date.UTC(2026, 9, 5) + i * 60_000).toISOString() }));
  const old = ref("old-selected", { status: "selected", first_seen_at: "2026-08-01T00:00:00Z" });
  const oldSample = ref("old-sample", { status: "sample_needed", first_seen_at: "2026-08-02T00:00:00Z" });
  const db = fakeDb({
    assortment_collections: [{ id: "c1", direction: "bags", kind: "bags_month", title: "План", period: "2026-11", status: "draft", version: 1, updated_at: "2026-10-05T00:00:00Z", responsible: null }],
    assortment_collection_items: [],
    assortment_references: [...recent, old, oldSample],
    assortment_observations: [], assortment_media: [], assortment_decisions: [],
  });
  const candidates = await loadCandidates(db, "c1");
  const ids = new Set(candidates.map((c) => c.id));
  assert.ok(ids.has("old-selected"), "отобранная модель старше окна новизны осталась кандидатом");
  assert.ok(ids.has("old-sample"));
  assert.ok(ids.has("new259"), "самые новые тоже на месте");
  assert.ok(!ids.has("new000"), "хвост новых за пределом 200 в пул не входит");
  assert.equal(candidates.length, 202, "200 новейших + 2 выбранных человеком");
});

test("Очередь ИИ-разбора находок: находки без фото в голове не выедают лимит — листаем дальше, пока не наберётся limit с фото", async () => {
  // 100 самых новых находок без фото, дальше — 15 старых с фото; лимит 5 (запрос «60 новейших» не нашёл бы ни одной).
  const noPhoto = Array.from({ length: 100 }, (_, i) => ref(`np${String(i).padStart(3, "0")}`, { first_seen_at: new Date(Date.UTC(2026, 9, 5) + i * 60_000).toISOString() }));
  const withPhoto = Array.from({ length: 15 }, (_, i) => ref(`wp${String(i).padStart(3, "0")}`, { first_seen_at: new Date(Date.UTC(2026, 8, 1) + i * 60_000).toISOString() }));
  const media = withPhoto.map((r) => ({ reference_id: r.id, storage_path: `p/${r.id}.jpg`, position: 0 }));
  const db = fakeDb({ assortment_references: [...noPhoto, ...withPhoto], assortment_media: media });
  const picked = await pendingForAi(db, 5);
  assert.equal(picked.length, 5);
  assert.ok(picked.every((id) => id.startsWith("wp")), "взяты находки с фото");
  assert.deepEqual(picked, ["wp014", "wp013", "wp012", "wp011", "wp010"], "свежие с фото — первыми");
  // Уже размеченные ИИ и «Рынок РФ» по-прежнему не берутся.
  const marked = withPhoto.map((r, i) => (i < 10 ? { ...r, attributes: { ai_meta: { v: 1 } } } : r));
  const ru = ref("ru1", { source_id: "S128", first_seen_at: "2026-10-06T00:00:00Z" });
  const db2 = fakeDb({ assortment_references: [...marked, ru], assortment_media: [...media, { reference_id: "ru1", storage_path: "p/ru1.jpg", position: 0 }] });
  const second = await pendingForAi(db2, 10);
  assert.deepEqual(second.sort(), ["wp010", "wp011", "wp012", "wp013", "wp014"], "ни размеченных, ни RU");
});
