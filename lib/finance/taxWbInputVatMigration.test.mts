import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(new URL("../../supabase/migrations/202609240003_tax_wb_input_vat_uuid.sql", import.meta.url), "utf8");
const coveringIndexSql = readFileSync(new URL("../../supabase/migrations/202609240005_tax_wb_input_vat_covering_index.sql", import.meta.url), "utf8");

test("агрегат НДС WB использует uuid-индекс без текстового приведения", () => {
  assert.match(sql, /p_cabinet_ids uuid\[\]/);
  assert.match(sql, /cabinet_id = any\(p_cabinet_ids\)/);
  assert.doesNotMatch(sql, /cabinet_id::text/);
});

test("годовой агрегат НДС WB использует частичный covering-индекс", () => {
  assert.match(coveringIndexSql, /create index concurrently if not exists wb_report_rows_cabinet_rr_dt_input_vat_idx/i);
  assert.match(coveringIndexSql, /\(cabinet_id, rr_dt\) include \(ppvz_vw_nds\)/i);
  assert.match(coveringIndexSql, /where ppvz_vw_nds is not null\s+and ppvz_vw_nds <> 0/i);
  assert.match(coveringIndexSql, /cabinet_id = any\(p_cabinet_ids\)/i);
});
