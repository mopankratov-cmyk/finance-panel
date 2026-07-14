import assert from "node:assert/strict";
import test from "node:test";
import { loadAllSupabasePages } from "../lib/supabase/loadAllPages";

test("dashboard pagination drains every Supabase page", async () => {
  const source = [1, 2, 3, 4, 5];
  const calls: Array<[number, number]> = [];
  const rows = await loadAllSupabasePages<number>(
    async (from, to) => {
      calls.push([from, to]);
      return { data: source.slice(from, to + 1), error: null };
    },
    { pageSize: 2, maxPages: 4, label: "Метрики" },
  );

  assert.deepEqual(rows, source);
  assert.deepEqual(calls, [[0, 1], [2, 3], [4, 5]]);
});

test("dashboard pagination fails closed on database errors and endless full pages", async () => {
  await assert.rejects(
    loadAllSupabasePages(async () => ({ data: null, error: { message: "timeout" } }), { label: "Отзывы" }),
    /Отзывы: timeout/,
  );
  await assert.rejects(
    loadAllSupabasePages(async () => ({ data: [1, 2], error: null }), { pageSize: 2, maxPages: 2, label: "Воронка" }),
    /Воронка превысил безопасный лимит 4 строк/,
  );
});
