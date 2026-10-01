import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("../../supabase/migrations/202610010002_dds_partial_wallet_provenance.sql", import.meta.url), "utf8");

test("partial target migration locks incoming rows and prevents over-allocation", () => {
  assert.match(sql, /order by review\.id for update/);
  assert.match(sql, /having coalesce\(sum\(parts\.amount\),0\)>review\.amount/);
  assert.match(sql, /Связанные части превышают поступление/);
});

test("transfer-in entries are projected onto the target statement row", () => {
  assert.match(sql, /v_item->>'role'='transfer-in'/);
  assert.match(sql, /'bank-review:'\|\|\(allocation->>'targetReviewId'\)/);
  assert.match(sql, /case when totals\.allocated=review\.amount then 'approved' else 'needs_info' end/);
  assert.match(sql, /dds_partial_wallet_provenance_version/);
});
