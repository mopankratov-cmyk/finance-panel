import test from "node:test";
import assert from "node:assert/strict";
import { persistFinanceAction } from "../lib/db";
import type { FinanceAction } from "../lib/types";

test("сохранение одного платежа не отправляет полное финансовое состояние", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: unknown;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const action: FinanceAction = {
    type: "UPDATE_PAYMENT",
    payload: {
      id: "payment-id",
      date: "2026-10-01",
      amount: -30_000,
      name: "Алексею Хлестову",
      category: "Оплата % по кредиту",
      accountId: "account-id",
      status: "planned",
      counterparty: "Алексей Хлестов",
    },
  };

  try {
    await persistFinanceAction(action);
    assert.deepEqual(requestBody, { action });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
