import assert from "node:assert/strict";
import test from "node:test";
import type { Payment } from "../types.ts";
import { analyzeFinances } from "./financialIntelligence.ts";

const criticalPayment = (id: string, date: string): Payment => ({
  id,
  date,
  name: "Погашение кредита",
  amount: -100_000,
  category: "Кредиты и займы",
  accountId: "account-1",
  status: "planned",
  counterparty: "Банк",
  comment: "[priority:A]",
});

test("critical payment becomes overdue only before today", () => {
  const result = analyzeFinances({
    accounts: [],
    payments: [
      criticalPayment("past", "2026-09-01"),
      criticalPayment("today", "2026-09-02"),
    ],
    today: "2026-09-02",
  });

  assert.equal(result.forecast.overdueCritical, 1);
  assert.match(result.alerts.find((alert) => alert.key.startsWith("overdue-a:"))?.message ?? "", /^1 плат/);
});
