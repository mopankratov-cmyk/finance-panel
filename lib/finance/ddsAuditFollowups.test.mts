import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(new URL("../../supabase/migrations/202609270001_dds_audit_followups.sql", import.meta.url), "utf8");

test("банковская проекция восстанавливается и получает точную роль цепочки", () => {
  assert.match(sql, /create trigger sync_bank_chain_entry_allocation/);
  assert.match(sql, /set import_source=payment\.import_source/);
  assert.match(sql, /not exists \([\s\S]*finance_bank_allocations/);
  assert.match(sql, /raise exception 'После восстановления остались факты банка без канонического распределения'/);
});

test("две доказанные исторические пары переводов связываются штатной функцией", () => {
  assert.match(sql, /duplicate\.status='rejected'/);
  assert.match(sql, /set matched_transfer_id=null/);
  assert.match(sql, /1c1ae4f4-baa8-4a04-bb69-0d4dbd4d0f39/);
  assert.match(sql, /530eb223-5d75-4682-9287-addbdb4bf30f/);
  assert.match(sql, /perform public\.link_bank_review_transfer/);
});

