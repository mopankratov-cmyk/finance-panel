import assert from "node:assert/strict";
import test from "node:test";
import { bankNameFromWalletName } from "./bankNames.ts";

test("банк выписки берётся из выбранного банковского кошелька", () => {
  assert.equal(bankNameFromWalletName("ИП Митриченко Точка", "Т-Банк"), "Банк Точка");
  assert.equal(bankNameFromWalletName("ИП Панкратов Ozon банк · ••••2301", "Банк Точка"), "Ozon Банк");
  assert.equal(bankNameFromWalletName("WB банк ИП Филиппов · ••••6002"), "ВБ Банк");
  assert.equal(bankNameFromWalletName("ООО РИО Альфа банк"), "Альфа-Банк");
  assert.equal(bankNameFromWalletName("Неизвестный счёт", "Банковская выписка"), "Банковская выписка");
});

test("БИК в имени файла имеет приоритет над ошибочным названием кошелька", () => {
  assert.equal(
    bankNameFromWalletName("40802810501500468430 044525104.xlsx · WB банк ИП Филиппов"),
    "Банк Точка",
  );
});
