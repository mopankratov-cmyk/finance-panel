import assert from "node:assert/strict";
import test from "node:test";
import { destinationBankFromPurpose, trustedBankCounterparty } from "./bankCounterparty";

test("не доверяет ФИО у безымянного перевода в другой банк", () => {
  assert.equal(trustedBankCounterparty({
    amount: -4_300,
    counterparty: "Базиян Вилен",
    purpose: "Перевод СБП. Перевод в T-Bank. Операция по счету ****5250",
  }), "");
});

test("снимает контрагента с выдачи наличных", () => {
  assert.equal(trustedBankCounterparty({ amount: -20_000, counterparty: "Новиков Валерий", purpose: "Выдача наличных денег в банкомате" }), "");
});

test("сохраняет явно названного отправителя", () => {
  assert.equal(trustedBankCounterparty({ amount: 2_901, counterparty: "П. Максим Олегович", purpose: "Перевод на карту. Перевод от П. Максим Олегович" }), "П. Максим Олегович");
});

test("не сохраняет контрагента, который противоречит названному получателю", () => {
  assert.equal(trustedBankCounterparty({ amount: -100_000, counterparty: "Новиков Валерий Михайлович", purpose: "Перевод по номеру телефона. Получатель Артем Сергеевич Ф. через СБП" }), "");
});

test("показывает банк назначения из текста операции", () => {
  assert.equal(destinationBankFromPurpose("Перевод СБП. Перевод в T-Bank. Операция по счету ****5250"), "Т-Банк");
});
