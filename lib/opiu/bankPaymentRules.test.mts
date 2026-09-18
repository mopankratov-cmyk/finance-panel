import assert from "node:assert/strict";
import test from "node:test";
import { mandatoryBankCategory } from "./bankPaymentRules.ts";

test("Internet Resheniya goods receipts always use marketplace sales", () => {
  for (const purpose of ["Оплата за тов. по дог. ИР №123", "ОПЛАТА  за тов. по дог. ИР", "Оплата за товары по договору ИР 33"]) {
    assert.equal(mandatoryBankCategory({ amount: 100, counterpartyInn: "7704217370", purpose }), "Продажи на МП");
  }
});
test("Internet Resheniya receipt is recognized by name when a bank omits the separate INN field", () => {
  assert.equal(mandatoryBankCategory({
    amount: 1_084_170.61,
    counterparty: "Интернет Решения, ООО ИНН: 7704217370",
    purpose: "Оплата за тов. по дог. ИР-19803/20 от 24.05.2020 согл.сч. №45286684 от 17.08.26.",
  }), "Продажи на МП");
});
test("ENP withdrawals use the USN tax category", () => {
  for (const purpose of ["ЕНП Пополнение счета", "Единый налоговый платеж", "Пополнение счета ЕНП без НДС"]) {
    assert.equal(mandatoryBankCategory({ amount: -560_842.33, counterpartyInn: "7727406020", purpose }), "УСН");
  }
});
test("does not classify withdrawals, other taxpayers or unrelated purposes", () => {
  const row = { amount: 100, counterpartyInn: "7704217370", purpose: "Оплата за тов. по дог. ИР" };
  for (const change of [{ amount: -100 }, { counterpartyInn: "7704217371" }, { purpose: "Возврат обеспечения" }]) assert.equal(mandatoryBankCategory({ ...row, ...change }), null);
});
test("does not classify incoming ENP text as a tax payment", () => {
  assert.equal(mandatoryBankCategory({ amount: 100, purpose: "ЕНП Пополнение счета" }), null);
});
