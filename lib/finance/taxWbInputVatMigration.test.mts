import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(new URL("../../supabase/migrations/202609240003_tax_wb_input_vat_uuid.sql", import.meta.url), "utf8");

test("агрегат НДС WB использует uuid-индекс без текстового приведения", () => {
  assert.match(sql, /p_cabinet_ids uuid\[\]/);
  assert.match(sql, /cabinet_id = any\(p_cabinet_ids\)/);
  assert.doesNotMatch(sql, /cabinet_id::text/);
});
