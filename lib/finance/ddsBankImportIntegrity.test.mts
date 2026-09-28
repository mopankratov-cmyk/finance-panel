import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(new URL("../../supabase/migrations/202609280002_dds_bank_import_integrity.sql", import.meta.url), "utf8");

test("перепривязка платежа обновляет оригинал и роль банковского распределения", () => {
  assert.match(sql, /transaction_id=excluded\.transaction_id/);
  assert.match(sql, /chain_revision=excluded\.chain_revision/);
  assert.match(sql, /join public\.finance_bank_transactions transaction on transaction\.review_item_id=payment_reviews\.review_id/);
  assert.match(sql, /Остались распределения, привязанные не к канонической банковской операции/);
});

test("односторонний технический перевод нельзя провести обычным платежом", () => {
  assert.match(sql, /create trigger guard_unmatched_bank_transfer_payment/);
  assert.match(sql, /review\.matched_transfer_id is null/);
  assert.match(sql, /Укажите второй кошелёк перевода или загрузите встречную выписку/);
});

test("известная выписка Точки получает правильный банк и неизвестные остатки", () => {
  assert.match(sql, /1b865aa1-74eb-4691-80b0-7bb28ce34671/);
  assert.match(sql, /bank_name='Банк Точка',opening_balance=null,closing_balance=null/);
});
