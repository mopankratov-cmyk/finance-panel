import assert from "node:assert/strict";
import test from "node:test";
import { normalizeStatement } from "./bankStatementPdf.ts";

const raw = {
  bank: "ВБ Банк", owner: "ИП Филиппов", ownerInn: "330573647518",
  accountNumber: "40802810900000016002", openingBalance: 0, closingBalance: 100,
  declaredDebit: 50, declaredCredit: 150,
  rows: [
    { date: "22.09.2026", amount: -50, counterparty: "А", documentNumber: "1" },
    { date: "23.09.2026", amount: 150, counterparty: "Б", documentNumber: "2" },
  ],
};

test("PDF сохраняет корректные направления по контрольным итогам", () => {
  const result = normalizeStatement(raw, "hash");
  assert.deepEqual(result.rows.map((row) => row.amount), [-50, 150]);
  assert.equal(result.warnings.length, 0);
});

test("PDF исправляет глобально перепутанные дебет и кредит", () => {
  const result = normalizeStatement({ ...raw, rows: raw.rows.map((row) => ({ ...row, amount: -row.amount })) }, "hash");
  assert.deepEqual(result.rows.map((row) => row.amount), [-50, 150]);
  assert.ok(result.warnings.some((warning) => /направления операций исправлены/i.test(warning)));
});

test("PDF показывает контрольное расхождение, а не скрывает его", () => {
  const result = normalizeStatement({ ...raw, rows: [{ date: "22.09.2026", amount: -40, documentNumber: "1" }] }, "hash");
  assert.equal(result.declaredDebit, 40);
  assert.ok(result.warnings.some((warning) => /не совпали с контрольными итогами/i.test(warning)));
});
