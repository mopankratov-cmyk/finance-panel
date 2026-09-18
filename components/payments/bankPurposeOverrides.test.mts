import assert from "node:assert/strict";
import test from "node:test";
import type { BankSuggestion } from "./bankAutoClassify.ts";
import { applyBankPurposes } from "./bankPurposeOverrides.ts";

const suggestion: BankSuggestion = {
  row: {
    id: "hash:1",
    date: "2026-09-10",
    amount: -55_000,
    counterparty: "Казначейство России",
    counterpartyInn: "7727406020",
    counterpartyAccount: "",
    purpose: "Распознанный текст",
    documentNumber: "15",
  },
  category: null,
  companyId: "main",
  accountId: "bank",
  confidence: 0.9,
  reasons: [],
  needsReview: true,
  transferCandidateId: null,
};

test("edited purpose reaches the bank review payload without changing the parsed source", () => {
  const [result] = applyBankPurposes([suggestion], new Map([["hash:1", " ЕНП Пополнение счета "]]));
  assert.equal(result.row.purpose, "ЕНП Пополнение счета");
  assert.equal(suggestion.row.purpose, "Распознанный текст");
});

test("purpose of another operation remains untouched", () => {
  const other = { ...suggestion, row: { ...suggestion.row, id: "hash:2" } };
  const result = applyBankPurposes([suggestion, other], new Map([["hash:1", "Новое назначение"]]));
  assert.equal(result[1], other);
});
