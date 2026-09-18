import assert from "node:assert/strict";
import test from "node:test";
import { bankOperationIdentity, operationIdentityFromReasons } from "./bankOperationIdentity.ts";

const operation = {
  bankAccountNumber: "40702 810 0 00000000001",
  date: "2026-09-03",
  amount: -560_842.33,
  documentNumber: "ПП-15",
  counterpartyAccount: "40101810000000010001",
  counterpartyInn: "7727406020",
  counterparty: "Казначейство России",
};

test("the same operation has one identity across overlapping statement files", () => {
  assert.equal(bankOperationIdentity(operation), bankOperationIdentity({ ...operation, counterparty: "КАЗНАЧЕЙСТВО РОССИИ" }));
});

test("different payment documents on one date remain different operations", () => {
  assert.notEqual(bankOperationIdentity(operation), bankOperationIdentity({ ...operation, documentNumber: "ПП-16" }));
});

test("an identity is not guessed without a bank account or document number", () => {
  assert.equal(bankOperationIdentity({ ...operation, documentNumber: "" }), null);
  assert.equal(bankOperationIdentity({ ...operation, bankAccountNumber: "" }), null);
});

test("stored identity is read from review reasons", () => {
  const identity = bankOperationIdentity(operation)!;
  assert.equal(operationIdentityFromReasons(["reason", identity]), identity);
  assert.equal(operationIdentityFromReasons(null), null);
});
