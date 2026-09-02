import assert from "node:assert/strict";
import test from "node:test";
import { analyzeFinances } from "../opiu/financialIntelligence.ts";

test("просроченный налог без метки приоритета считается критичным, как и в календаре", () => {
  const result = analyzeFinances({
    accounts: [{ id: "a", name: "Счёт", type: "bank", currency: "RUB", balance: 1_000_000 }],
    payments: [{ id: "p", date: "2026-08-01", name: "УСН за 2 квартал", amount: -50_000, category: "УСН", accountId: "a", status: "planned", counterparty: "ФНС" }],
    today: "2026-09-03",
  });
  assert.equal(result.forecast.overdueCritical, 1);
  assert.ok(result.alerts.some((alert) => alert.key.startsWith("overdue-a:")));
});
