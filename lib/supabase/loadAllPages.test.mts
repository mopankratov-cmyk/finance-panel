import test from "node:test";
import assert from "node:assert/strict";
import { loadAllSupabasePages } from "./loadAllPages";

interface Row { id: number }

/** Страничник, который на первых N вызовах отдаёт ошибку, затем — данные. */
function flakyPager(failures: number, message: string, rows: Row[] = [{ id: 1 }]) {
  let calls = 0;
  return {
    get calls() { return calls; },
    fetchPage: async () => {
      calls += 1;
      if (calls <= failures) return { data: null, error: { message } };
      return { data: rows, error: null };
    },
  };
}

test("временный statement timeout переживается повтором", async () => {
  const pager = flakyPager(1, "canceling statement due to statement timeout");
  const rows = await loadAllSupabasePages<Row>(pager.fetchPage, { label: "Тест" });
  assert.deepEqual(rows, [{ id: 1 }]);
  assert.equal(pager.calls, 2, "должен был сходить повторно");
});

test("повторов не больше заданного числа — потом честная ошибка", async () => {
  const pager = flakyPager(99, "statement timeout");
  await assert.rejects(
    () => loadAllSupabasePages<Row>(pager.fetchPage, { label: "Тест", retries: 2 }),
    /statement timeout/,
  );
  // Первый заход плюс два повтора.
  assert.equal(pager.calls, 3);
});

test("ошибка запроса не повторяется — падаем сразу", async () => {
  const pager = flakyPager(99, "permission denied for function rnp_report");
  await assert.rejects(
    () => loadAllSupabasePages<Row>(pager.fetchPage, { label: "Тест" }),
    /permission denied/,
  );
  assert.equal(pager.calls, 1, "неповторяемая ошибка не должна ретраиться");
});

test("retries: 0 отключает повторы", async () => {
  const pager = flakyPager(1, "fetch failed");
  await assert.rejects(
    () => loadAllSupabasePages<Row>(pager.fetchPage, { label: "Тест", retries: 0 }),
    /fetch failed/,
  );
  assert.equal(pager.calls, 1);
});

test("успешная выборка не делает лишних запросов", async () => {
  const pager = flakyPager(0, "не используется");
  await loadAllSupabasePages<Row>(pager.fetchPage, { label: "Тест" });
  assert.equal(pager.calls, 1);
});
