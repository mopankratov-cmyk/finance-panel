import assert from "node:assert/strict";
import test from "node:test";
import { INTERCOMPANY_LOAN_CATEGORIES, LOAN_CATEGORIES } from "./categories.ts";
import { buildSettlements } from "./settlements.ts";
import type { Payment } from "../types.ts";

const payment = (patch: Partial<Payment>): Payment => ({
  id: crypto.randomUUID(), date: "2026-01-10", name: "", amount: 0, category: "Прочее", accountId: "account", status: "done", counterparty: "", ...patch,
});

test("беспроцентный долг собирает получение и возврат одного человека", () => {
  const rows = buildSettlements([
    payment({ id: "received", date: "2026-01-10", amount: 100_000, category: LOAN_CATEGORIES.receipt, counterparty: "Иван Асанов" }),
    payment({ id: "returned", date: "2026-02-10", amount: -40_000, category: "Оплаты по кредитам и займам", counterparty: "Иван Асанов" }),
  ], new Map(), []);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].counterparty, "Иван Асанов");
  assert.equal(rows[0].side, "we_owe");
  assert.equal(rows[0].issuedOrReceived, 100_000);
  assert.equal(rows[0].returned, 40_000);
  assert.equal(rows[0].balance, 60_000);
});

test("официальный договор и зеркальная loan-in запись не попадают во взаиморасчёты", () => {
  const rows = buildSettlements([
    payment({ amount: 100_000, category: LOAN_CATEGORIES.receipt, counterparty: "Банк", comment: "[loan:00000000-0000-0000-0000-000000000001:receipt]" }),
    payment({ amount: 50_000, category: LOAN_CATEGORIES.receipt, counterparty: "ИП Филиппов", comment: `[dds-chain:${encodeURIComponent(JSON.stringify({ id: "chain", revision: 1, amount: 50_000, date: "2026-01-10", label: "Займ", role: "loan-in" }))}]` }),
  ], new Map(), []);
  assert.deepEqual(rows, []);
});

test("займ между Филипповым и основной группой показывается один раз", () => {
  const companies = [
    { id: "main", name: "ООО РИО", groupName: "Основная группа" },
    { id: "fil", name: "ИП Филиппов", groupName: "ИП Филиппов" },
  ];
  const rows = buildSettlements([
    payment({ id: "issued", amount: -80_000, category: INTERCOMPANY_LOAN_CATEGORIES.issued, counterparty: "ИП Филиппов", companyId: "main" }),
    payment({ id: "returned", date: "2026-02-10", amount: 30_000, category: INTERCOMPANY_LOAN_CATEGORIES.returned, counterparty: "ИП Филиппов", companyId: "main" }),
  ], new Map(), companies);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].counterparty, "ИП Филиппов ↔ Основная группа");
  assert.equal(rows[0].side, "owed_to_us");
  assert.equal(rows[0].balance, 50_000);
});
