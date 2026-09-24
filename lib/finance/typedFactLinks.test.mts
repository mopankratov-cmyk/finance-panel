import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../../supabase/migrations/202609240003_dds_typed_fact_links.sql", import.meta.url), "utf8");
const loanRoute = readFileSync(new URL("../../app/api/finance/loans/schedule/route.ts", import.meta.url), "utf8");

test("новые кредитные связи пишутся в paid_by_payment_id без метки в comment", () => {
  assert.match(loanRoute, /paid_by_payment_id: factId/);
  assert.doesNotMatch(loanRoute, /\[paid-by:\$\{factId\}\]/);
});

test("миграция удаляет только метки, у которых уже есть типизированная связь", () => {
  assert.match(migration, /where settled_by_payment_id is not null/);
  assert.match(migration, /schedule\.paid_by_payment_id is not null/);
  assert.match(migration, /ensure_calendar_fact_exclusive/);
  assert.match(migration, /ensure_loan_fact_exclusive/);
  assert.match(migration, /protect_linked_fact_from_chain_edit/);
});
