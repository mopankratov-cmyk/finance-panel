import assert from "node:assert/strict";
import test from "node:test";
import { bankLedgerProjectionPayload } from "./bankLedgerProjection.ts";

test("канонический банковский слой получает оригинал выписки и неизменяемые реквизиты операции", () => {
  const statement = {
    documentHash: "a".repeat(64), bank: "Ozon Банк", owner: "ИП Панкратов", ownerInn: "123",
    accountNumber: "40801", dateFrom: "2026-09-01", dateTo: "2026-09-02", openingBalance: 10,
    closingBalance: 30, declaredDebit: 5, declaredCredit: 25, warnings: [], notes: [],
    rows: [{ id: "row-1", date: "2026-09-02", amount: 25, counterparty: "ООО", counterpartyInn: "7701", counterpartyAccount: "40701", purpose: "исходное", documentNumber: "42" }],
  };
  const suggestions = [{ row: statement.rows[0], companyId: null, accountId: null, category: null, confidence: 0, reasons: [], needsReview: true, transferCandidateId: null }];
  const stored = [{ id: "11111111-1111-4111-8111-111111111111", externalId: "row-1", date: "2026-09-02", amount: 25, purpose: "исправленное пользователем", counterparty: "ООО", counterpartyInn: "7701", reasons: ["__operation_identity:hash"] }];
  const payload = bankLedgerProjectionPayload(statement, "ozon.xlsx", suggestions, stored);
  assert.equal(payload.statement.bank, "Ozon Банк");
  assert.equal(payload.statement.operationCount, 1);
  assert.equal(payload.transactions[0].documentNumber, "42");
  assert.equal(payload.transactions[0].counterpartyAccount, "40701");
  assert.equal(payload.transactions[0].purpose, "исходное");
  assert.equal(payload.transactions[0].operationIdentity, "hash");
});
