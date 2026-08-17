import assert from "node:assert/strict";
import test from "node:test";

import { loadAllSupabasePages } from "../lib/supabase/loadAllPages";

// Экран «Реклама» листал десятки страниц статистики последовательно —
// каждый round-trip к БД складывался в секунды. Пачечное листание обязано
// сохранять порядок строк и прежние границы (короткая страница = конец,
// превышение maxPages = ошибка), иначе агрегаты по кампаниям поедут.

function fakePages(total: number, pageSize: number) {
  const calls: number[] = [];
  const fetchPage = async (from: number, to: number) => {
    calls.push(from);
    const rows: number[] = [];
    for (let value = from; value <= Math.min(to, total - 1); value++) rows.push(value);
    return { data: rows, error: null };
  };
  return { calls, fetchPage };
}

test("пачечное листание сохраняет порядок строк", async () => {
  const { fetchPage } = fakePages(2_500, 1000);
  const rows = await loadAllSupabasePages<number>(fetchPage, { pageSize: 1000, maxPages: 10, concurrency: 4 });
  assert.equal(rows.length, 2_500);
  assert.deepEqual(rows.slice(0, 3), [0, 1, 2]);
  // Строгая монотонность по всей выборке — страницы склеены по номерам, не по времени ответа.
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i] > rows[i - 1], `порядок сломан на ${i}`);
});

test("короткая страница завершает листание, лишние пачки не запрашиваются", async () => {
  const { calls, fetchPage } = fakePages(1_500, 1000);
  const rows = await loadAllSupabasePages<number>(fetchPage, { pageSize: 1000, maxPages: 100, concurrency: 4 });
  assert.equal(rows.length, 1_500);
  // Первая пачка (4 страницы) уже содержит короткую вторую страницу — второй пачки быть не должно.
  assert.equal(calls.length, 4);
});

test("ошибка страницы прерывает листание с прежним текстом", async () => {
  const fetchPage = async (from: number) => from === 0
    ? { data: Array.from({ length: 1000 }, (_, i) => i), error: null }
    : { data: null, error: { message: "боль" } };
  await assert.rejects(
    loadAllSupabasePages(fetchPage, { pageSize: 1000, maxPages: 10, concurrency: 4, label: "Тест" }),
    /Тест: боль/,
  );
});

test("превышение maxPages остаётся ошибкой и с пачками", async () => {
  const fetchPage = async (from: number, to: number) => ({
    data: Array.from({ length: to - from + 1 }, (_, i) => from + i),
    error: null,
  });
  await assert.rejects(
    loadAllSupabasePages(fetchPage, { pageSize: 1000, maxPages: 8, concurrency: 3, label: "Тест" }),
    /превысил безопасный лимит 8000 строк/,
  );
});

test("роут рекламы листает тяжёлые выборки пачками", async () => {
  const { readFile } = await import("node:fs/promises");
  const route = await readFile(new URL("../app/api/adverts/list/route.ts", import.meta.url), "utf8");
  assert.match(route, /concurrency: STATS_PAGE_CONCURRENCY/);
  assert.match(route, /CAMPAIGN_PAGE_CONCURRENCY/);
});
