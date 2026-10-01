import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { autofillPaymentChainCash, preferredChainCashAccount, type PaymentChainDraft } from "../lib/finance/paymentChains";
import type { Account } from "../lib/types";

const account = (id: string, name: string): Account => ({
  id, name, type: "cash", currency: "RUB", balance: 0,
});

const companies = [
  { id: "main", name: "ИП Панкратов", groupName: "Основная группа" },
  { id: "filippov", name: "ИП Филиппов", groupName: "ИП Филиппов" },
];

test("цепочка выбирает историческую кассу Филиппова, когда в базе есть Наличка и Наличные", () => {
  const accounts = [
    account("generic-old", "Наличные"),
    account("filippov-cash", "Наличка"),
    account("main-cash", "Наличка ИП Панкратов"),
  ];
  assert.equal(preferredChainCashAccount(companies[1], accounts, companies)?.id, "filippov-cash");

  const draft: PaymentChainDraft = {
    id: "00000000-0000-4000-8000-000000000001", revision: 0, label: "Дивиденды", sourceDate: "2026-09-27",
    sourceAmount: 1976.55, sourceAccountId: "bank", sourceCompanyId: "filippov", cashAccountId: "", throughCash: false,
    allocations: [{ id: "00000000-0000-4000-8000-000000000002", amount: 1976.55, date: "2026-09-27", name: "Дивиденды Максима Панкратова", category: "Дивиденды", companyId: "main", accountId: "bank", counterparty: "Максим Панкратов", excluded: false }],
    originPaymentIds: [], bankReviewId: null,
  };
  const filled = autofillPaymentChainCash(draft, companies, accounts);
  assert.equal(filled.throughCash, true);
  assert.equal(filled.cashAccountId, "filippov-cash");
  assert.equal(filled.allocations[0].accountId, "main-cash");
});

test("финансовый контроль не отправляет весь массив платежей через браузер", async () => {
  const panel = await readFile(new URL("../components/calendar/FinancialAlertsPanel.tsx", import.meta.url), "utf8");
  const intelligence = await readFile(new URL("../app/api/opiu/intelligence/route.ts", import.meta.url), "utf8");
  const sync = await readFile(new URL("../app/api/opiu/sync/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(panel, /JSON\.stringify\(\{ accounts, payments \}\)/);
  assert.match(panel, /readApiResponse<FinancialIntelligenceResult/);
  assert.match(intelligence, /loadFinanceStateServer\(\)/);
  assert.match(sync, /loadFinanceStateServer\(\)/);
});
