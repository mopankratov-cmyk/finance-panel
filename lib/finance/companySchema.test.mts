import assert from "node:assert/strict";
import test from "node:test";
import { COMPANY_BASE_COLUMNS, COMPANY_TAX_COLUMNS, readCompaniesCompat } from "./companySchema.ts";

test("отсутствующие налоговые колонки не блокируют загрузку компаний", async () => {
  const calls: string[] = [];
  const loaded = await readCompaniesCompat(async (columns) => {
    calls.push(columns);
    return columns === COMPANY_TAX_COLUMNS
      ? { error: { code: "42703", message: "column companies.tax_system does not exist" }, data: null }
      : { error: null, data: [{ id: "company" }] };
  });
  assert.deepEqual(calls, [COMPANY_TAX_COLUMNS, COMPANY_BASE_COLUMNS]);
  assert.equal(loaded.taxSettingsAvailable, false);
  assert.deepEqual(loaded.result.data, [{ id: "company" }]);
});

test("доступная схема не требует повторной выборки, прочие ошибки не скрываются", async () => {
  for (const error of [null, { code: "42501", message: "permission denied" }, { code: "42703", message: "column companies.name does not exist" }]) {
    let calls = 0;
    const loaded = await readCompaniesCompat(async () => { calls++; return { error }; });
    assert.equal(calls, 1);
    assert.equal(loaded.result.error, error);
  }
});
