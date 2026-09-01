import assert from "node:assert/strict";
import test from "node:test";
import { suggestLoanSplits } from "../../components/payments/loanReviewSuggestion.ts";
import type { BankReviewItem } from "../../components/payments/bankReviewStore.ts";
import type { Payment } from "../types.ts";

const item: BankReviewItem = {
  id: "review", batchId: "batch", documentHash: "hash", sourceFileName: "statement.pdf", externalId: "row",
  date: "2026-08-18", amount: -118_300, bankAccountNumber: "1", ownerInn: "1", companyId: "company",
  accountId: "account", counterparty: "Банк Точка", counterpartyInn: "", purpose: "Кредит Точка Кучеренко",
  category: "Оплаты по кредитам и займам", confidence: 1, reasons: [], status: "ready", matchedTransferId: null,
  managerQuestion: null, managerAnswer: null,
};

const payment = (id: string, amount: number, part: "principal" | "interest"): Payment => ({
  id, date: "2026-08-18", amount: -amount, name: part === "principal" ? "Погашение тела — Банк Точка" : "Проценты по кредиту — Банк Точка",
  category: part === "principal" ? "Погашение тела кредита" : "Проценты по кредитам и займам", accountId: "account",
  status: "planned", counterparty: "Банк Точка", comment: `[loan:loan-1:schedule:row-1:${part}]`,
});

test("кредитный факт разбивается по единственному совпавшему графику", () => {
  const splits = suggestLoanSplits(item, [payment("body", 100_000, "principal"), payment("interest", 18_300, "interest")]);
  assert.deepEqual(splits?.map((part) => [part.amount, part.category]), [
    [100_000, "Погашение тела кредита"],
    [18_300, "Проценты по кредитам и займам"],
  ]);
});

test("не предлагает разбиение, если сумма графика не совпала", () => {
  assert.equal(suggestLoanSplits(item, [payment("body", 100_000, "principal")]), null);
});
