import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(new URL("../../supabase/migrations/202610070002_link_mapped_company_transfers.sql", import.meta.url), "utf8");

test("known accounts of one company are accepted as bank transfer evidence", () => {
  assert.match(sql, /mapped_company_accounts/);
  assert.match(sql, /o\.company_id=i\.company_id/);
  assert.match(sql, /o\.account_id<>i\.account_id/);
  assert.match(sql, /o\.date=i\.date/);
});

test("backfill scans all unlinked transfers and does not hard-code the reported amount", () => {
  assert.match(sql, /r\.matched_transfer_id is null/);
  assert.match(sql, /round\(i\.amount::numeric,2\)=-round\(o\.amount::numeric,2\)/);
  assert.doesNotMatch(sql, /2901/);
  assert.match(sql, /link_mapped_company_transfers/);
});

test("explicit counterparty accounts still block a conflicting match", () => {
  assert.match(sql, /nullif\(o\.counterparty_account,''\) is null or o\.counterparty_account=i\.bank_account_number/);
  assert.match(sql, /nullif\(i\.counterparty_account,''\) is null or i\.counterparty_account=o\.bank_account_number/);
});
