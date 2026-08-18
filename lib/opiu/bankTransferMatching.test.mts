import assert from "node:assert/strict";
import test from "node:test";
import { findCertainTransferPairs, type TransferMatchRow } from "./bankTransferMatching.ts";

const row = (patch: Partial<TransferMatchRow>): TransferMatchRow => ({
  id: "row",
  date: "2026-08-01",
  amount: -1000,
  bankAccountNumber: "111",
  ownerInn: "10",
  counterpartyAccount: "222",
  counterpartyInn: "20",
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

test("does not choose when two incoming operations are equally suitable", () => {
  const pairs = findCertainTransferPairs([
    row({ id: "out" }),
    row({ id: "in-1", amount: 1000, bankAccountNumber: "222", ownerInn: "20" }),
    row({ id: "in-2", amount: 1000, bankAccountNumber: "222", ownerInn: "20" }),
  ]);
  assert.deepEqual(pairs, []);
});
