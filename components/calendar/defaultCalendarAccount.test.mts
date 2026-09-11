import assert from "node:assert/strict";
import test from "node:test";
import { defaultCalendarAccountId } from "./defaultCalendarAccount.ts";

test("по умолчанию выбирается кошелёк pankster group независимо от порядка", () => {
  assert.equal(defaultCalendarAccountId([
    { id: "other", name: "ИП Панкратов", balance: 0, type: "bank", currency: "RUB" },
    { id: "group", name: "Pankster Group", balance: 0, type: "bank", currency: "RUB" },
  ]), "group");
});

test("без pankster group остаётся первый доступный кошелёк", () => {
  assert.equal(defaultCalendarAccountId([
    { id: "first", name: "Основной", balance: 0, type: "bank", currency: "RUB" },
  ]), "first");
});
