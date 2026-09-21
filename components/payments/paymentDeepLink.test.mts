import assert from "node:assert/strict";
import test from "node:test";
import { shouldOpenCompanySettings } from "./paymentDeepLink.ts";

test("прямая ссылка из ОПиУ открывает настройки компаний", () => {
  assert.equal(shouldOpenCompanySettings("?companies=1"), true);
  assert.equal(shouldOpenCompanySettings("?companies=0"), false);
  assert.equal(shouldOpenCompanySettings(""), false);
});
