import assert from "node:assert/strict";
import test from "node:test";
import { applyBankLedgerReadModel } from "../lib/finance/bankLedgerReadModel";
import type { Payment } from "../lib/types";

const payment = (overrides: Partial<Payment & { importSource: string | null }> = {}) => ({
  id: "payment-1",
  date: "2026-09-01",
  name: "Исходное название",
  amount: -100,
  category: "Старая статья",
  accountId: "old-account",
  companyId: "old-company",
  importSource: "bank-review:11111111-1111-1111-1111-111111111111",
  status: "done" as const,
  counterparty: "Старый контрагент",
  comment: "Комментарий пользователя",
  ...overrides,
});

const allocation = {
  payment_id: "payment-1",
  amount: -125,
  operation_date: "2026-09-02",
  category: "Закуп товара",
  account_id: "canonical-account",
  company_id: "canonical-company",
  counterparty: "Поставщик",
  status: "done" as const,
};

test("проведённый банковский платёж читает денежные поля из canonical allocation", () => {
  const [result] = applyBankLedgerReadModel([payment()], [allocation]);
  assert.deepEqual(result, {
    ...payment(),
    amount: -125,
    date: "2026-09-02",
    category: "Закуп товара",
    accountId: "canonical-account",
    companyId: "canonical-company",
    counterparty: "Поставщик",
  });
  assert.equal(result.name, "Исходное название");
  assert.equal(result.comment, "Комментарий пользователя");
  assert.equal(result.importSource, payment().importSource);
});

test("наличные, план и банковская строка без allocation остаются без изменений", () => {
  const cash = payment({ id: "cash", importSource: null, accountId: "cash-account" });
  const planned = payment({ id: "payment-1", status: "planned" });
  const pendingBank = payment({ id: "pending-bank" });
  const rows = [cash, planned, pendingBank];
  const result = applyBankLedgerReadModel(rows, [allocation]);
  assert.deepEqual(result, rows);
  assert.equal(result[0], cash);
  assert.equal(result[1], planned);
  assert.equal(result[2], pendingBank);
});

test("allocation не может подменить ручной платёж с совпавшим id", () => {
  const manual = payment({ importSource: null });
  assert.equal(applyBankLedgerReadModel([manual], [allocation])[0], manual);
});
