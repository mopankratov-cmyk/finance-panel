import assert from "node:assert/strict";
import test from "node:test";
import { bankNameFromWalletName } from "./bankNames.ts";

test("банк выписки берётся из выбранного банковского кошелька", () => {
  assert.equal(bankNameFromWalletName("ИП Митриченко Точка", "Т-Банк"), "Банк Точка");
  assert.equal(bankNameFromWalletName("ИП Панкратов Ozon банк · ••••2301", "Банк Точка"), "Ozon Банк");
  assert.equal(bankNameFromWalletName("Неизвестный счёт", "Банковская выписка"), "Банковская выписка");
});
