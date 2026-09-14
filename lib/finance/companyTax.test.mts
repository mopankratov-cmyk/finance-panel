import assert from "node:assert/strict";
import test from "node:test";
import { parseCompanyTaxSystem, parseCompanyVatMode } from "./companyTax.ts";

test("настройки компании принимают только поддерживаемые налоговые значения", () => {
  assert.equal(parseCompanyTaxSystem("usn_income"), "usn_income");
  assert.equal(parseCompanyTaxSystem(""), null);
  assert.equal(parseCompanyTaxSystem("unknown"), undefined);
  assert.equal(parseCompanyVatMode("22"), "22");
  assert.equal(parseCompanyVatMode(null), null);
  assert.equal(parseCompanyVatMode(22), undefined);
});
