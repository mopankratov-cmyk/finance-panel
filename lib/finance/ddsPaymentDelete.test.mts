import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../../supabase/migrations/202609220004_dds_payment_delete_rpc.sql", import.meta.url), "utf8");
const route = readFileSync(new URL("../../app/api/finance/payments/[id]/route.ts", import.meta.url), "utf8");

test("удаление факта одной транзакцией возвращает кредит и календарь в план", () => {
  assert.match(migration, /create or replace function public\.delete_dds_payment/);
  assert.match(migration, /update public\.loan_schedule_rows[\s\S]*status = 'planned', paid_by_payment_id = null/);
  assert.match(migration, /\[calendar-fact:/);
  assert.match(migration, /delete from public\.payments where id = p_payment_id/);
});

test("API не откатывается к опасному обычному удалению без миграции", () => {
  assert.match(route, /isDdsActualPayment/);
  assert.match(route, /db\.rpc\("delete_dds_payment"/);
  assert.doesNotMatch(route, /from\("payments"\)\.delete\(/);
});
