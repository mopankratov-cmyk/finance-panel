import assert from "node:assert/strict";
import test from "node:test";
import { paymentIdFromSearch, shouldOpenCompanySettings } from "./paymentDeepLink.ts";

test("прямая ссылка из ОПиУ открывает настройки компаний", () => {
  assert.equal(shouldOpenCompanySettings("?companies=1"), true);
  assert.equal(shouldOpenCompanySettings("?companies=0"), false);
  assert.equal(shouldOpenCompanySettings(""), false);
});

test("ссылка из кредита передаёт конкретный факт ДДС", () => {
  assert.equal(paymentIdFromSearch("?payment=payment-42"), "payment-42");
  assert.equal(paymentIdFromSearch("?companies=1"), null);
  assert.equal(paymentIdFromSearch(`?payment=${"a".repeat(129)}`), null);
});
