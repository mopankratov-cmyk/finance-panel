import assert from "node:assert/strict";
import test from "node:test";
import { mandatoryBankCategory } from "./bankPaymentRules.ts";

test("Internet Resheniya goods receipts always use marketplace sales", () => {
  for (const purpose of ["Оплата за тов. по дог. ИР №123", "ОПЛАТА  за тов. по дог. ИР", "Оплата за товары по договору ИР 33"]) {
    assert.equal(mandatoryBankCategory({ amount: 100, counterpartyInn: "7704217370", purpose }), "Продажи на МП");
  }
});
test("does not classify withdrawals, other taxpayers or unrelated purposes", () => {
  const row = { amount: 100, counterpartyInn: "7704217370", purpose: "Оплата за тов. по дог. ИР" };
  for (const change of [{ amount: -100 }, { counterpartyInn: "7704217371" }, { purpose: "Возврат обеспечения" }]) assert.equal(mandatoryBankCategory({ ...row, ...change }), null);
});
