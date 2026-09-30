import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("../../supabase/migrations/202609290001_dds_chain_bank_targets.sql", import.meta.url), "utf8");

test("chain migration approves selected incoming bank rows and releases removed targets", () => {
  assert.match(sql, /create or replace function public\.save_dds_payment_chain/);
  assert.match(sql, /allocation->>'targetReviewId'/);
  assert.match(sql, /set status='needs_info',updated_at=now\(\)/);
  assert.match(sql, /set status=case when p_cancel then 'needs_info' else 'approved' end,updated_at=now\(\)/);
  assert.doesNotMatch(sql, /create or replace function public\.confirm_bank_review_items/);
});
