import assert from "node:assert/strict";
import test from "node:test";
import { isSharedPersonalWalletName } from "./sharedPersonalWallets.ts";

test("распознаёт только общие личные карты", () => {
  for (const name of ["Карта Озон", "Ozon Банк · карта физлица Филиппова", "Т-Банк физлица Филиппова", "Сбербанк карта Максима Панкратова"]) {
    assert.equal(isSharedPersonalWalletName(name), true, name);
  }
  for (const name of ["ИП Филиппов Точка ·••••8430", "ИП Панкратов ОЗОН банк ·••••2301", "ООО РИО Сбербанк"]) {
    assert.equal(isSharedPersonalWalletName(name), false, name);
  }
});
