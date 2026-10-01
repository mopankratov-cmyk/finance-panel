import assert from "node:assert/strict";
import test from "node:test";
import { paymentIdFromSearch, paymentLedgerFiltersFromSearch, shouldOpenBankImport, shouldOpenCompanySettings } from "./paymentDeepLink.ts";

test("прямая ссылка из ОПиУ открывает настройки компаний", () => {
  assert.equal(shouldOpenCompanySettings("?companies=1"), true);
  assert.equal(shouldOpenCompanySettings("?companies=0"), false);
  assert.equal(shouldOpenCompanySettings(""), false);
});

test("прямая ссылка из Обнала открывает импорт банковских выписок", () => {
  assert.equal(shouldOpenBankImport("?bankImport=1"), true);
  assert.equal(shouldOpenBankImport("?bankImport=0"), false);
});

test("ссылка из кредита передаёт конкретный факт ДДС", () => {
  assert.equal(paymentIdFromSearch("?payment=payment-42"), "payment-42");
  assert.equal(paymentIdFromSearch("?companies=1"), null);
  assert.equal(paymentIdFromSearch(`?payment=${"a".repeat(129)}`), null);
});

test("ссылка из Обнала передаёт безопасные фильтры реестра ДДС", () => {
  assert.deepEqual(paymentLedgerFiltersFromSearch("?cashout=1&from=2026-09-01&to=2026-09-30&company=rio"), { from: "2026-09-01", to: "2026-09-30", company: "rio", cashout: true });
  assert.equal(paymentLedgerFiltersFromSearch("?cashout=1&from=bad&to=2026-09-30"), null);
  assert.equal(paymentLedgerFiltersFromSearch("?from=2026-09-01&to=2026-09-30"), null);
});
