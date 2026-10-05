import assert from "node:assert/strict";
import test from "node:test";

import { financeReducer } from "./reducer.ts";
import type { FinanceState, Payment } from "./types.ts";

const initial: FinanceState = { accounts: [], payments: [], loans: [] };

function payment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: "payment-1", date: "2026-10-08", name: "Проценты", amount: 36_000,
    category: "Оплата % по кредиту", accountId: "account-1", status: "planned", counterparty: "Ольга",
    ...overrides,
  };
}

test("добавление планового погашения не может превратить расход в поступление", () => {
  const next = financeReducer(initial, { type: "ADD_PAYMENT", payload: payment() });
  assert.equal(next.payments[0]?.amount, -36_000);
});

test("изменение статьи на погашение кредита исправляет направление суммы", () => {
  const state: FinanceState = { ...initial, payments: [payment({ category: "Прочее", amount: 36_000 })] };
  const next = financeReducer(state, { type: "UPDATE_PAYMENT", payload: payment({ category: "Оплаты по кредитам и займам", amount: 36_000 }) });
  assert.equal(next.payments[0]?.amount, -36_000);
});
