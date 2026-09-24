import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(new URL("../../supabase/migrations/202609240004_tax_employee_status.sql", import.meta.url), "utf8");

test("статус сотрудников на 2026 год закреплён для указанных компаний", () => {
  assert.match(sql, /add column if not exists has_employees boolean/);
  for (const company of ["ооо рио", "ооо глобалкос", "ооо иллюмей", "ип панкратов"]) {
    assert.match(sql, new RegExp(company));
  }
  assert.match(sql, /then 50/);
  assert.match(sql, /else 100/);
});
