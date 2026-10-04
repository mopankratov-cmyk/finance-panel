import assert from "node:assert/strict";
import test from "node:test";
import { recordObservation, runRow, snapshotRows } from "../lib/assortment/observationLog.ts";

test("Снимок: дубль товара схлопывается, https и до 4 фото, пустое — null", () => {
  const rows = snapshotRows("run-1", "S131", "2026-10-05", [
    { sourceItemId: "a", direction: "jackets", title: "  Куртка  ", brand: " befree ", images: ["https://a/1", "http://a/2", "https://a/1", "https://a/3", "https://a/4", "https://a/5"], badges: ["new", "new"] },
    { sourceItemId: "a", direction: "jackets", title: "Куртка (повтор)", images: [] },
    { sourceItemId: "b", direction: "bags", title: null, brand: null, images: null, badges: [] },
  ]);
  assert.equal(rows.length, 2, "один и тот же товар за прогон — одна строка");
  const a = rows[0];
  assert.equal(a.run_id, "run-1");
  assert.equal(a.source_id, "S131");
  assert.equal(a.source_item_id, "a");
  assert.equal(a.observed_on, "2026-10-05");
  assert.equal(a.present, true);
  assert.equal(a.title, "Куртка", "берётся первое (более полное) вхождение товара в прогоне");
  assert.equal(a.brand, "befree");
  assert.deepEqual(a.image_urls, ["https://a/1", "https://a/3", "https://a/4", "https://a/5"], "только https, без дублей, до 4");
  const b = rows[1];
  assert.equal(b.title, null);
  assert.equal(b.brand, null);
  assert.equal(b.image_urls, null, "нет фото — null, а не пустой массив");
  assert.equal(b.badges, null);
});

test("Журнал прогона: поля, неотрицательные счётчики, обрезка ошибки", () => {
  const row = runRow("run-7", "2026-10-05", {
    sourceId: "S001", direction: "bags", coverage: "window",
    seen: 300, added: 4, startedAt: "2026-10-05T05:00:00.000Z", snapshotId: "snap_abc", error: "x".repeat(500),
  });
  assert.equal(row.run_id, "run-7");
  assert.equal(row.source_id, "S001");
  assert.equal(row.direction, "bags");
  assert.equal(row.observed_on, "2026-10-05");
  assert.equal(row.coverage, "window");
  assert.equal(row.seen, 300);
  assert.equal(row.added, 4);
  assert.equal(row.started_at, "2026-10-05T05:00:00.000Z");
  assert.equal(row.snapshot_id, "snap_abc");
  assert.equal((row.error as string).length, 400, "ошибка обрезается до 400 знаков");

  const bare = runRow("run-8", "2026-10-05", { sourceId: "S014", direction: null, coverage: "full", seen: -5, added: -1 });
  assert.equal(bare.direction, null);
  assert.equal(bare.seen, 0, "отрицательное не пишем");
  assert.equal(bare.added, 0);
  assert.equal(bare.snapshot_id, null);
  assert.equal(bare.error, null);
});

function fakeDb(opts: { runError?: { message: string }; snapError?: { message: string } } = {}) {
  const runs: Array<Record<string, unknown>> = [];
  const snaps: Array<Record<string, unknown>> = [];
  const db = {
    from: (table: string) => ({
      insert: async (row: Record<string, unknown>) => {
        if (table === "assortment_run" && opts.runError) return { error: opts.runError };
        if (table === "assortment_run") runs.push(row);
        return { error: null };
      },
      upsert: async (rows: Array<Record<string, unknown>>) => {
        if (table === "assortment_item_snapshot" && opts.snapError) return { error: opts.snapError };
        if (table === "assortment_item_snapshot") snaps.push(...rows);
        return { error: null };
      },
    }),
  };
  return { db: db as never, runs, snaps };
}

test("recordObservation: пишет прогон и снимки, возвращает run_id", async () => {
  const { db, runs, snaps } = fakeDb();
  const runId = await recordObservation(db, { sourceId: "S131", direction: "jackets", coverage: "full", seen: 2, added: 1 }, [
    { sourceItemId: "a", direction: "jackets", title: "Куртка" },
    { sourceItemId: "b", direction: "jackets", title: "Пальто" },
  ]);
  assert.match(String(runId), /^[0-9a-f-]{36}$/, "вернулся uuid прогона");
  assert.equal(runs.length, 1);
  assert.equal(runs[0].coverage, "full");
  assert.equal(runs[0].run_id, runId);
  assert.equal(snaps.length, 2);
  assert.ok(snaps.every((s) => s.run_id === runId), "снимки ссылаются на прогон");
});

test("recordObservation: таблиц ещё нет — не падаем, возвращаем null, снимки не пишем", async () => {
  const { db, snaps } = fakeDb({ runError: { message: 'relation "public.assortment_run" does not exist' } });
  const runId = await recordObservation(db, { sourceId: "S131", direction: "bags", coverage: "full", seen: 1, added: 0 }, [
    { sourceItemId: "a", direction: "bags" },
  ]);
  assert.equal(runId, null, "миграции нет — тихо пропускаем");
  assert.equal(snaps.length, 0);
});

test("recordObservation: сбой снимка не роняет обход (прогон записан)", async () => {
  const { db, runs } = fakeDb({ snapError: { message: "boom" } });
  const runId = await recordObservation(db, { sourceId: "S001", direction: "jackets", coverage: "window", seen: 1, added: 0 }, [
    { sourceItemId: "a", direction: "jackets" },
  ]);
  assert.equal(runId, null, "снимок не лёг — возвращаем null, но без исключения");
  assert.equal(runs.length, 1, "журнал прогона при этом записан");
});

test("recordObservation: снимок лёг не весь — прогон помечается неполным (иначе живые товары «пропали» бы в полном прогоне)", async () => {
  const runUpdates: Array<Record<string, unknown>> = [];
  let snapshotCalls = 0;
  const db = {
    from: (table: string) => ({
      insert: async () => ({ error: null }),
      upsert: async () => {
        if (table === "assortment_item_snapshot") {
          snapshotCalls += 1;
          if (snapshotCalls === 2) return { error: { message: "statement timeout" } };
        }
        return { error: null };
      },
      update: (patch: Record<string, unknown>) => {
        runUpdates.push(patch);
        return { eq: () => Promise.resolve({ error: null }) };
      },
    }),
  } as never;
  const items = Array.from({ length: 1200 }, (_, i) => ({ sourceItemId: `id${i}`, direction: "bags" as const, title: `Bag ${i}` }));
  const runId = await recordObservation(db, { sourceId: "S001", direction: "bags", coverage: "full", seen: 1200, added: 0 }, items);
  assert.equal(runId, null, "сбой не роняет обход");
  assert.equal(snapshotCalls, 2, "первая пачка легла, вторая упала");
  assert.equal(runUpdates.length, 1, "прогон исправлен");
  assert.equal(runUpdates[0].coverage, "partial");
  assert.match(String(runUpdates[0].error), /снимок записан не полностью: statement timeout/);
});
