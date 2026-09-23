import assert from "node:assert/strict";
import test from "node:test";
import { bankOperationIdentity, operationIdentityFromReasons, uniqueLegacyBankOperationMatch } from "./bankOperationIdentity.ts";

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

test("same amount and document on another owner account is not a duplicate", () => {
  assert.notEqual(bankOperationIdentity(operation), bankOperationIdentity({
    ...operation,
    bankAccountNumber: "40702 810 0 00000000002",
  }));
});

test("same owner account, date and amount for another counterparty is not a duplicate", () => {
  assert.notEqual(bankOperationIdentity(operation), bankOperationIdentity({
    ...operation,
    counterpartyAccount: "40101810000000010002",
    counterpartyInn: "7704217370",
  }));
});

test("same requisites with another date or amount are separate operations", () => {
  assert.notEqual(bankOperationIdentity(operation), bankOperationIdentity({ ...operation, date: "2026-09-04" }));
  assert.notEqual(bankOperationIdentity(operation), bankOperationIdentity({ ...operation, amount: -560_842.34 }));
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

const legacy = {
  id: "legacy",
  externalId: "old-document:20",
  date: "2026-09-10",
  amount: -15_000,
  counterparty: "Панкратов Максим Олегович ИНН:280888215133",
  purpose: "Перевод собственных средств. Без НДС.",
};

test("an overlapping statement recognizes one legacy row without an account identity", () => {
  assert.equal(uniqueLegacyBankOperationMatch({ ...legacy, id: "incoming", externalId: "new-document:20" }, [legacy])?.id, "legacy");
});

test("the same exporter row may add a harmless purpose prefix", () => {
  assert.equal(uniqueLegacyBankOperationMatch({
    ...legacy,
    id: "incoming",
    externalId: "new-document:20",
    purpose: "Сертификат. Перевод собственных средств. Без НДС.",
  }, [legacy])?.id, "legacy");
});

test("legacy fallback refuses a different counterparty or an ambiguous match", () => {
  assert.equal(uniqueLegacyBankOperationMatch({ ...legacy, counterparty: "Другой контрагент" }, [legacy]), null);
  assert.equal(uniqueLegacyBankOperationMatch({ ...legacy, id: "incoming" }, [legacy, { ...legacy, id: "second" }]), null);
});
