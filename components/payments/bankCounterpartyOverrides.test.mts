import test from "node:test";
import assert from "node:assert/strict";
import { applyBankCounterparties } from "./bankCounterpartyOverrides.ts";
import type { BankSuggestion } from "./bankAutoClassify.ts";
const suggestion: BankSuggestion = { row: { id: "hash:1", date: "2026-09-10", amount: -55000, counterparty: "ООО Банк", counterpartyInn: "1234567890", counterpartyAccount: "40817810000000000001", purpose: "Перевод", documentNumber: "1" }, category: "Дивиденды", companyId: "main", accountId: "bank", confidence: .9, reasons: [], needsReview: false, transferCandidateId: null };
test("chosen counterparty reaches the initial queue payload without mutating bank identifiers or the parsed source", () => {
  const [result] = applyBankCounterparties([suggestion], new Map([["hash:1", " Андрей Коровкин "]]));
  assert.equal(result.row.counterparty, "Андрей Коровкин");
  assert.deepEqual({ ...result.row, counterparty: suggestion.row.counterparty }, suggestion.row);
  assert.equal(suggestion.row.counterparty, "ООО Банк");
});
test("clearing a counterparty is explicit and another operation is unaffected", () => {
  const other = { ...suggestion, row: { ...suggestion.row, id: "hash:2" } };
  const result = applyBankCounterparties([suggestion, other], new Map([["hash:1", ""]]));
  assert.equal(result[0].row.counterparty, "");
  assert.equal(result[1], other);
});
