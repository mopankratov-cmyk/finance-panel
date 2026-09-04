import assert from "node:assert/strict";
import test from "node:test";
import { getDailyBalancesForMonth, getTotalBalance, getTotalBalanceByCurrency, getWeekSummary } from "../calculations.ts";
import { todayISO } from "../format.ts";
import type { Account, Payment } from "../types.ts";

const today = todayISO();
const shift = (days: number) => {
  const [y, m, d] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};
const acc = (id: string, opening: number, currency: "RUB" | "USD" = "RUB"): Account =>
  ({ id, name: id, type: "bank", currency, balance: 1, openingBalance: opening, openingDate: shift(-10) });
const pay = (accountId: string, date: string, amount: number, status: Payment["status"] = "done"): Payment =>
  ({ id: `${accountId}${date}${amount}`, accountId, date, amount, status, name: "", category: "Прочее", counterparty: "" });

test("текущий остаток — из открытия и фактов, USD отдельно", () => {
  const accounts = [acc("rub", 100_000), acc("usd", 2_000, "USD")];
  const payments = [pay("rub", shift(-3), -30_000), pay("rub", shift(-1), 5_000, "planned"), pay("usd", shift(-2), -500)];
  assert.equal(getTotalBalance(accounts, payments), 70_000);
  assert.deepEqual(getTotalBalanceByCurrency(accounts, payments), { RUB: 70_000, USD: 1_500 });
});

test("прогноз по дням: фильтр календаря не меняет остаток, просроченный план не переписывает прошлое", () => {
  const accounts = [acc("rub", 100_000)];
  const all = [
    pay("rub", shift(-3), -30_000),
    pay("rub", shift(-2), -20_000, "planned"),  // просроченный план
    pay("rub", shift(2), -50_000, "planned"),
  ];
  const [y, m] = [Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1];
  const full = getDailyBalancesForMonth(y, m, accounts, all);
  const filtered = getDailyBalancesForMonth(y, m, accounts, all, all.filter((p) => p.amount > -25_000));
  const dayAfter = shift(3);
  if (full.has(dayAfter)) {
    assert.equal(full.get(dayAfter)?.balance, 20_000);
    assert.equal(filtered.get(dayAfter)?.balance, 20_000, "срез фильтра не влияет на остаток");
    assert.equal(filtered.get(shift(2))?.payments.length, 0, "но влияет на список дня");
  }
  if (full.has(shift(-2))) assert.equal(full.get(shift(-2))?.balance, 70_000, "прошлое без просроченного плана");
});

test("итог недели: поток по видимому срезу, остаток по всем платежам", () => {
  const accounts = [acc("rub", 100_000)];
  const all = [pay("rub", today, -10_000), pay("rub", shift(1), -40_000, "planned")];
  const summary = getWeekSummary(today, accounts, all, all.filter((p) => p.status === "done"));
  assert.equal(summary.totalExpense, 10_000, "видимый срез — только факт");
  assert.ok(summary.runningBalance <= 90_000, "остаток на конец недели учитывает и план");
});
