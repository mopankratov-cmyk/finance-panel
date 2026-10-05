import assert from "node:assert/strict";
import test from "node:test";
import { cashoutKind, isCashoutCompanyName } from "./cashout.ts";

const payment = (overrides: Record<string, unknown> = {}) => ({
  amount: -10_000,
  name: "Оплата поставщику",
  counterparty: "ООО Ромашка",
  comment: "Банковская выписка",
  importSource: "bank-review:46aa2e42-2b5a-47bb-a24b-9fa7bde28bc4",
  ...overrides,
});

test("распознаёт банкомат, СБП и перевод физлицу", () => {
  assert.equal(cashoutKind(payment({ name: "Выдача наличных через банкомат" })), "atm");
  assert.equal(cashoutKind(payment({ name: "Перевод по СБП" })), "sbp");
  assert.equal(cashoutKind(payment({ name: "Перевод средств", counterparty: "Иванов Иван Иванович" })), "individual");
  assert.equal(cashoutKind(payment({ name: "Перевод средств", counterparty: "Иванов И.И." })), "individual");
  assert.equal(cashoutKind(payment({ amount: 8_000, name: "Внесение наличных через банкомат" })), "atm_deposit");
  assert.equal(cashoutKind(payment({ amount: 8_000, name: "Внесение средств через ATM" })), "atm_deposit");
});

test("не считает ручные, прочие поступления, юрлиц и связанные внутренние переводы", () => {
  assert.equal(cashoutKind(payment({ importSource: "manual-dds:test", name: "СБП" })), null);
  assert.equal(cashoutKind(payment({ amount: 10_000, name: "СБП" })), null);
  assert.equal(cashoutKind(payment({ name: "Перевод", counterparty: "ООО Ромашка" })), null);
  assert.equal(cashoutKind(payment({ name: "СБП", comment: "[dds-bank-transfer:pair]" })), null);
});

test("банковская комиссия не попадает в обнал даже если в назначении есть СБП", () => {
  assert.equal(cashoutKind(payment({
    name: "Комиссия Банка по операции Прочая выплата через СБП",
  })), null);
});

test("выбирает только Панкратова и РИО", () => {
  assert.equal(isCashoutCompanyName("ИП Панкратов"), true);
  assert.equal(isCashoutCompanyName("ООО «РИО»"), true);
  assert.equal(isCashoutCompanyName("Общая группа РИО"), false);
  assert.equal(isCashoutCompanyName("Слоёно"), false);
});
