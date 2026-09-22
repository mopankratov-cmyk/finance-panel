import assert from "node:assert/strict";
import test from "node:test";
import type { Account, Payment } from "../../lib/types";
import { bankStatementSourceAccounts, ddsReconciliationAccountRows } from "./ddsReconciliationAccounts";

const accounts: Account[] = [
  { id: "calendar", name: "PANKSTER GROUP", type: "cash", currency: "RUB", balance: 53_863 },
  { id: "bank", name: "Озон банк", type: "bank", currency: "RUB", balance: 999, openingBalance: 1_000, openingDate: "2026-09-01" },
  { id: "cash", name: "Наличка", type: "cash", currency: "RUB", balance: 0, openingBalance: 500, openingDate: "2026-09-01" },
];

const payment = (overrides: Partial<Payment>): Payment => ({
  id: "fact", date: "2026-09-02", name: "Факт", amount: 100, category: "Продажи на МП", accountId: "bank",
  status: "done", counterparty: "", importSource: "bank-review:row", ...overrides,
});

test("сверка показывает только кошельки с фактическими операциями ДДС", () => {
  const rows = ddsReconciliationAccountRows(accounts, [
    payment({}),
    payment({ id: "cash-fact", accountId: "cash", amount: -50, importSource: "manual-dds:cash-fact" }),
    payment({ id: "calendar-plan", accountId: "calendar", status: "planned", importSource: null }),
  ], "2026-09-30");
  assert.deepEqual(rows.map((row) => row.account.name), ["Озон банк", "Наличка"]);
  assert.deepEqual(rows.map((row) => row.balance), [1_100, 450]);
});

test("при разборе выписки источником можно выбрать только банковский счёт", () => {
  assert.deepEqual(bankStatementSourceAccounts(accounts).map((account) => account.name), ["Озон банк"]);
});

