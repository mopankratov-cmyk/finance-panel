import assert from "node:assert/strict";
import test from "node:test";
import {
  companyTaxSystemSupportsRate,
  companyTaxTotalRate,
  formatCompanyTaxRate,
  parseCompanyTaxRate,
  parseCompanyTaxSystem,
  parseCompanyVatMode,
} from "./companyTax.ts";

test("настройки компании принимают только поддерживаемые налоговые значения", () => {
  assert.equal(parseCompanyTaxSystem("usn_income"), "usn_income");
  assert.equal(parseCompanyTaxSystem(""), null);
  assert.equal(parseCompanyTaxSystem("unknown"), undefined);
  assert.equal(parseCompanyVatMode("22"), "22");
  assert.equal(parseCompanyVatMode(null), null);
  assert.equal(parseCompanyVatMode(22), undefined);
});

test("процент налога принимает целые и дробные значения с точкой или запятой", () => {
  assert.equal(parseCompanyTaxRate("1"), 1);
  assert.equal(parseCompanyTaxRate("1,25"), 1.25);
  assert.equal(parseCompanyTaxRate(5), 5);
  assert.equal(parseCompanyTaxRate(""), null);
  assert.equal(parseCompanyTaxRate("1.2345"), undefined);
  assert.equal(parseCompanyTaxRate(-1), undefined);
  assert.equal(parseCompanyTaxRate(101), undefined);
});

test("основная и дополнительная ставки образуют отображаемый итог", () => {
  assert.equal(companyTaxTotalRate(1, 1), 2);
  assert.equal(companyTaxTotalRate(5, null), 5);
  assert.equal(companyTaxTotalRate(null, null), null);
  assert.equal(formatCompanyTaxRate(1.25), "1,25");
});

test("процент показывается только для режимов с единой ставкой компании", () => {
  assert.equal(companyTaxSystemSupportsRate("usn_income"), true);
  assert.equal(companyTaxSystemSupportsRate("usn_income_expense"), true);
  assert.equal(companyTaxSystemSupportsRate("eshn"), true);
  assert.equal(companyTaxSystemSupportsRate("patent"), false);
  assert.equal(companyTaxSystemSupportsRate("npd"), false);
  assert.equal(companyTaxSystemSupportsRate(null), false);
});
