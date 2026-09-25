import test from "node:test";
import assert from "node:assert/strict";
import { groupPaymentOperations } from "./paymentOperationGroups.ts";
import { splitEvenly, balanceLast } from "./paymentSplitAmounts.ts";
import { buildChainEntries, type PaymentChainDraft } from "./paymentChains.ts";
import type { Payment } from "../types.ts";
const companies = [{ id: "main", name: "ИП Митриченко", groupName: "Основная группа" }, { id: "kor", name: "ИП Коровкин", groupName: "Коровкин" }];
const draft: PaymentChainDraft = { id: "chain", revision: 0, label: "55 тысяч", sourceDate: "2026-09-10", sourceAmount: 55000, sourceAccountId: "bank", sourceCompanyId: "main", cashAccountId: "cash", throughCash: true, bankReviewId: null, originPaymentIds: [], allocations: [
  { id: "salary", amount: 15000, date: "2026-09-11", name: "Зарплата", category: "Зарплата административного персонала", companyId: "main", accountId: "cash", counterparty: "Сотрудник", excluded: false },
  { id: "dividend", amount: 30000, date: "2026-09-15", name: "Дивиденды", category: "Дивиденды", companyId: "kor", accountId: "korcash", counterparty: "Коровкин", excluded: false },
] };
let counter = 0;
const entries = buildChainEntries(draft, companies, () => "payment-" + counter++).map(e => e.payment);

test("date or company filter selects one source and expansion includes all expense dates without summing loans as parts", () => {
  const visible = entries.filter(p => p.date === "2026-09-15");
  const rows = groupPaymentOperations(visible, entries);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source.amount, -55000);
  assert.equal(rows[0].source.date, "2026-09-10");
  assert.equal(rows[0].source.companyId, "main");
  assert.deepEqual(rows[0].parts.map(p => p.date), ["2026-09-11", "2026-09-15"]);
  assert.equal(rows[0].remainder, 10000);
  assert.equal(groupPaymentOperations(entries, entries).length, 1);
});
test("cancelled old versions stay out of expanded parts; ordinary payments remain independent", () => {
  const old = entries.map(p => ({ ...p, id: "old-" + p.id, status: "cancelled" as const }));
  const plain: Payment = { ...entries[0], id: "plain", comment: undefined };
  const rows = groupPaymentOperations([...entries, plain], [...old, ...entries, plain]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].parts.length, 2);
  assert.equal(rows[1].source.id, "plain");
});
test("legacy split uses the original bank total and source company, never a sum guessed from expenses", () => {
  const id = "30000000-0000-4000-8000-000000000001";
  const legacy = entries.filter(p => p.date > draft.sourceDate).map(p => ({ ...p, comment: undefined, importSource: "bank-review:" + id + ":" + p.id }));
  assert.equal(groupPaymentOperations(legacy, legacy).length, 2);
  const rows = groupPaymentOperations(legacy, legacy, [{ id, label: "Выписка", amount: 55000, date: draft.sourceDate, lastDate: "2026-09-15", count: 2, revision: 0, status: "active", sourceAccountId: "bank", sourceCompanyId: "main" }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source.amount, -55000);
  assert.equal(rows[0].source.companyId, "main");
  assert.equal(rows[0].source.accountId, "bank");
});
test("an ordinary bank payment is not shown as a one-part split", () => {
  const id = "30000000-0000-4000-8000-000000000002";
  const plain: Payment = {
    id: "plain-bank",
    date: "2026-09-11",
    name: "По счету №3266",
    amount: -21_000,
    category: "Административные подрядчики",
    accountId: "bank",
    companyId: "main",
    status: "done",
    counterparty: "ООО ПИОНЕР ПРО",
    importSource: `bank-review:${id}`,
  };
  const [row] = groupPaymentOperations([plain], [plain], [{
    id,
    label: plain.name,
    amount: 21_000,
    date: plain.date,
    lastDate: plain.date,
    count: 1,
    revision: 0,
    status: "active",
    sourceAccountId: "bank",
    sourceCompanyId: "main",
  }]);
  assert.equal(row.chainId, undefined);
  assert.equal(row.source, plain);
  assert.deepEqual(row.parts, []);
});
test("две стороны банковского перевода видны как связанная пара", () => {
  const pairId = "40000000-0000-4000-8000-000000000001";
  const outgoing: Payment = { ...entries[0], id: "bank-out", amount: -451000, category: "Выбытие — Перевод между счетами", comment: `[dds-bank-transfer:${pairId}]`, importSource: "bank-review:out" };
  const incoming: Payment = { ...entries[0], id: "bank-in", amount: 451000, category: "Поступление — Перевод между счетами", comment: `[dds-bank-transfer:${pairId}]`, importSource: "bank-review:in" };
  const rows = groupPaymentOperations([outgoing], [outgoing,incoming]);
  assert.equal(rows[0].bankTransferId, pairId);
  assert.deepEqual(rows[0].linkedTransfers?.map(payment=>payment.id), ["bank-out","bank-in"]);
  assert.equal(rows[0].chainId, undefined);
});
test("equal split keeps every kopeck and automatic last part surfaces overdraft instead of silently clamping it", () => {
  assert.deepEqual(splitEvenly(100, 3), [33.34, 33.33, 33.33]);
  assert.deepEqual(balanceLast([{ amount: 5000 }, { amount: 10000 }, { amount: 30000 }], 55000).map(p => p.amount), [5000, 10000, 40000]);
  assert.deepEqual(balanceLast([{ amount: 60000 }, { amount: 0 }], 55000).map(p => p.amount), [60000, -5000]);
  assert.deepEqual(splitEvenly(100, 0), []);
});
