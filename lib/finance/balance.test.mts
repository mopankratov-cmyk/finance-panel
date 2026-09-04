import assert from "node:assert/strict";
import test from "node:test";
import { accountBalance, projectedBalance, rubAccounts, totalRubBalance } from "./balance.ts";
import type { Account, Payment } from "../types.ts";

const acc = (id: string, opening: number, openingDate: string | null, currency: "RUB" | "USD" = "RUB"): Account =>
  ({ id, name: id, type: "bank", currency, balance: 999, openingBalance: opening, openingDate });
const pay = (accountId: string, date: string, amount: number, status: Payment["status"] = "done"): Payment =>
  ({ id: `${accountId}-${date}-${amount}`, accountId, date, amount, status, name: "", category: "Прочее", counterparty: "" });

test("остаток = открытие + факты с даты открытия; отменённые и планы не считаются", () => {
  const account = acc("a", 100_000, "2026-09-01");
  const payments = [
    pay("a", "2026-08-31", -50_000),            // до открытия — не считается
    pay("a", "2026-09-02", -30_000),
    pay("a", "2026-09-03", 10_000, "planned"),  // план — не факт
    pay("a", "2026-09-03", -5_000, "cancelled"),
    pay("b", "2026-09-02", -1_000),             // чужой счёт
  ];
  assert.equal(accountBalance(account, payments, "2026-09-03"), 70_000);
  assert.equal(accountBalance(account, payments, "2026-09-01"), 100_000, "до факта — остаток открытия");
});

test("без даты открытия — старое ручное число (переходный режим)", () => {
  const account = { ...acc("a", 0, null), balance: 12_345 };
  assert.equal(accountBalance(account, [pay("a", "2026-09-02", -30_000)], "2026-09-03"), 12_345);
});

test("прогноз: прошлое не меняется от планов, будущий факт не удваивается", () => {
  const account = acc("a", 100_000, "2026-09-01");
  const today = "2026-09-03";
  const payments = [
    pay("a", "2026-09-02", -30_000),
    pay("a", "2026-09-02", -20_000, "planned"),   // просроченный план — не влияет на прошлое
    pay("a", "2026-09-05", -50_000, "planned"),
    pay("a", "2026-09-06", -10_000),              // оплачено заранее: уже в факте, повторно не прибавляется
  ];
  assert.equal(projectedBalance([account], payments, today, "2026-09-02"), 70_000);
  assert.equal(projectedBalance([account], payments, today, today), 70_000, "сегодня — только факты по сегодня");
  assert.equal(projectedBalance([account], payments, today, "2026-09-05"), 20_000);
  assert.equal(projectedBalance([account], payments, today, "2026-09-07"), 20_000, "будущий done не считается дважды");
});

test("USD-счёт в рублёвый итог не входит", () => {
  const accounts = [acc("rub", 100, "2026-09-01"), acc("usd", 5_000, "2026-09-01", "USD")];
  assert.deepEqual(rubAccounts(accounts).map((account) => account.id), ["rub"]);
  assert.equal(totalRubBalance(accounts, [], "2026-09-03"), 100);
  assert.equal(projectedBalance(accounts, [pay("usd", "2026-09-05", -1_000, "planned")], "2026-09-03", "2026-09-06"), 100);
});
