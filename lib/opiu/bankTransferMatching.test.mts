import assert from "node:assert/strict";
import test from "node:test";
import { findCertainTransferPairs, type TransferMatchRow } from "./bankTransferMatching.ts";

const row = (patch: Partial<TransferMatchRow>): TransferMatchRow => ({
  id: "row",
  date: "2026-08-01",
  amount: -1000,
  bankAccountNumber: "111",
  companyId: "company-a",
  accountId: "account-a",
  ownerInn: "10",
  counterpartyAccount: "222",
  counterpartyInn: "20",
  category: "Выбытие — Перевод между счетами",
  purpose: "Перевод собственных средств",
  ...patch,
});

test("links an exact outgoing and incoming transfer from different statements", () => {
  const pairs = findCertainTransferPairs([
    row({ id: "out" }),
    row({ id: "in", amount: 1000, bankAccountNumber: "222", ownerInn: "20", counterpartyAccount: "111", counterpartyInn: "10", date: "2026-08-02" }),
  ]);
  assert.deepEqual(pairs, [{ outgoingId: "out", incomingId: "in" }]);
});

test("does not link equal amounts without account or INN evidence", () => {
  const pairs = findCertainTransferPairs([
    row({ id: "out", counterpartyAccount: "", counterpartyInn: "" }),
    row({ id: "in", amount: 1000, bankAccountNumber: "333", ownerInn: "30", counterpartyAccount: "", counterpartyInn: "" }),
  ]);
  assert.deepEqual(pairs, []);
});

test("links two accounts of the same owner by owner INN", () => {
  const pairs = findCertainTransferPairs([
    row({ id: "out", ownerInn: "280888215133", counterpartyAccount: "", counterpartyInn: "" }),
    row({ id: "in", amount: 1000, bankAccountNumber: "333", ownerInn: "280888215133", counterpartyAccount: "", counterpartyInn: "" }),
  ]);
  assert.deepEqual(pairs, [{ outgoingId: "out", incomingId: "in" }]);
});

test("links two mapped accounts of one company without bank requisites", () => {
  const pairs = findCertainTransferPairs([
    row({ id: "out", ownerInn: "", counterpartyAccount: "", counterpartyInn: "" }),
    row({
      id: "in",
      amount: 1000,
      bankAccountNumber: "222",
      accountId: "account-b",
      ownerInn: "",
      counterpartyAccount: "",
      counterpartyInn: "",
      category: "Поступление — Перевод между счетами",
      purpose: "Перевод на карту",
    }),
  ]);
  assert.deepEqual(pairs, [{ outgoingId: "out", incomingId: "in" }]);
});

test("does not infer a same-company transfer without transfer intent", () => {
  const pairs = findCertainTransferPairs([
    row({ id: "out", ownerInn: "", counterpartyAccount: "", counterpartyInn: "", category: "", purpose: "Покупка" }),
    row({ id: "in", amount: 1000, bankAccountNumber: "222", accountId: "account-b", ownerInn: "", counterpartyAccount: "", counterpartyInn: "", category: "", purpose: "Возврат" }),
  ]);
  assert.deepEqual(pairs, []);
});

test("same-company account mapping only links operations from the same date", () => {
  const pairs = findCertainTransferPairs([
    row({ id: "out", ownerInn: "", counterpartyAccount: "", counterpartyInn: "" }),
    row({ id: "in", date: "2026-08-02", amount: 1000, bankAccountNumber: "222", accountId: "account-b", ownerInn: "", counterpartyAccount: "", counterpartyInn: "" }),
  ]);
  assert.deepEqual(pairs, []);
});

test("does not choose when two incoming operations are equally suitable", () => {
  const pairs = findCertainTransferPairs([
    row({ id: "out" }),
    row({ id: "in-1", amount: 1000, bankAccountNumber: "222", ownerInn: "20", counterpartyAccount: "111" }),
    row({ id: "in-2", amount: 1000, bankAccountNumber: "222", ownerInn: "20", counterpartyAccount: "111" }),
  ]);
  assert.deepEqual(pairs, []);
});

test("links a closed batch of identical transfers between the same accounts", () => {
  const pairs = findCertainTransferPairs([
    row({ id: "out-2", counterpartyAccount: "" }),
    row({ id: "out-1", counterpartyAccount: "" }),
    row({ id: "in-2", amount: 1000, bankAccountNumber: "222", ownerInn: "10", counterpartyAccount: "", counterpartyInn: "" }),
    row({ id: "in-1", amount: 1000, bankAccountNumber: "222", ownerInn: "10", counterpartyAccount: "", counterpartyInn: "" }),
  ]);
  assert.deepEqual(pairs, [
    { outgoingId: "out-1", incomingId: "in-1" },
    { outgoingId: "out-2", incomingId: "in-2" },
  ]);
});

test("does not batch-link rows that also match another account", () => {
  const rows = [
    row({ id: "out-1", counterpartyAccount: "" }),
    row({ id: "out-2", counterpartyAccount: "" }),
    row({ id: "in-b-1", amount: 1000, bankAccountNumber: "222", ownerInn: "10", counterpartyAccount: "", counterpartyInn: "" }),
    row({ id: "in-b-2", amount: 1000, bankAccountNumber: "222", ownerInn: "10", counterpartyAccount: "", counterpartyInn: "" }),
    row({ id: "in-c-1", amount: 1000, bankAccountNumber: "333", ownerInn: "10", counterpartyAccount: "", counterpartyInn: "" }),
    row({ id: "in-c-2", amount: 1000, bankAccountNumber: "333", ownerInn: "10", counterpartyAccount: "", counterpartyInn: "" }),
  ];
  assert.deepEqual(findCertainTransferPairs(rows), []);
});

test("account conflicts cannot be overridden by matching taxpayer IDs",()=>{
  assert.deepEqual(findCertainTransferPairs([row({id:"out",counterpartyAccount:"999"}),row({id:"in",amount:1000,bankAccountNumber:"222",ownerInn:"20",counterpartyAccount:"111",counterpartyInn:"10"})]),[]);
});
test("matches account numbers without INN and rejects malformed dates",()=>{
  const outgoing=row({id:"out",ownerInn:"",counterpartyInn:""});
  const incoming=row({id:"in",amount:1000,bankAccountNumber:"222",counterpartyAccount:"111",ownerInn:"",counterpartyInn:""});
  assert.equal(findCertainTransferPairs([outgoing,incoming]).length,1);
  assert.deepEqual(findCertainTransferPairs([outgoing,{...incoming,date:"invalid"}]),[]);
});
