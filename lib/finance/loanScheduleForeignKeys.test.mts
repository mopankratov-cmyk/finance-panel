import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(new URL("../../supabase/migrations/202609220005_dds_loan_schedule_foreign_keys.sql", import.meta.url), "utf8");

test("график кредита закреплён за договором и платежами внешними ключами", () => {
  assert.match(sql, /foreign key \(loan_id\) references public\.loans\(id\) on delete cascade/);
  assert.match(sql, /foreign key \(paid_by_payment_id\) references public\.payments\(id\) on delete set null/);
  assert.match(sql, /foreign key \(calendar_payment_id\) references public\.payments\(id\) on delete set null/);
});

test("потеря факта возвращает оплаченную строку в план", () => {
  assert.match(sql, /before update of paid_by_payment_id/);
  assert.match(sql, /new\.status := 'planned'/);
});

test("миграция останавливается на старых осиротевших данных вместо тихого удаления", () => {
  assert.match(sql, /raise exception[\s\S]*осиротевшие связи/);
  assert.doesNotMatch(sql, /delete from public\.loan_schedule_rows/);
});
