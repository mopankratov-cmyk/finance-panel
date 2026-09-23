import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadConsumedFactIds } from "./factLinksServer.ts";

function fakeDb(): SupabaseClient {
  const rows = {
    payments: [
      { id: "calendar-plan", comment: "Комментарий изменён", settled_by_payment_id: "calendar-fact" },
      { id: "payroll-plan", comment: "[payroll-paid:payroll-fact]" },
    ],
    loan_schedule_rows: [{ paid_by_payment_id: "loan-fact" }],
  };
  return {
    from(table: keyof typeof rows) {
      const query = {
        select: () => query,
        not: () => query,
        like: () => query,
        or: () => query,
        order: () => query,
        range: async () => ({ data: rows[table], error: null }),
      };
      return query;
    },
  } as unknown as SupabaseClient;
}

test("сервер собирает занятые факты из меток и канонической связи кредита", async () => {
  const consumed = await loadConsumedFactIds(fakeDb());
  assert.deepEqual([...consumed].sort(), ["calendar-fact", "loan-fact", "payroll-fact"]);
});

test("текущий план можно переподтвердить, но чужие связи остаются заняты", async () => {
  const consumed = await loadConsumedFactIds(fakeDb(), "calendar-plan");
  assert.deepEqual([...consumed].sort(), ["loan-fact", "payroll-fact"]);
});
