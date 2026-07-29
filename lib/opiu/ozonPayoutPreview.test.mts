import assert from "node:assert/strict";
import test from "node:test";
import {
  OZON_PAYOUT_MAPPINGS,
  buildOzonPayoutPreview,
  classifyOzonReceipts,
  stableOzonReportKey,
  type ReceiptForPreview,
} from "./ozonPayoutPreview.ts";

const mapping = OZON_PAYOUT_MAPPINGS[0];
const base: ReceiptForPreview = {
  id: "p1", date: "2026-07-29", amount: 100, status: "done", category: "Продажи на МП",
  accountId: "other", name: "Выплата", counterparty: "ООО Интернет Решения", comment: "",
};

test("mapped account confirms Ozon receipt", () => {
  const result = classifyOzonReceipts([{ ...base, accountId: mapping.accountId }], mapping);
  assert.equal(result.confirmed.length, 1);
  assert.equal(result.unresolved.length, 0);
});

test("exact payer INN confirms receipt on a shared account", () => {
  const result = classifyOzonReceipts([{ ...base, comment: "ИНН плательщика 7704217370" }], mapping);
  assert.equal(result.confirmed.length, 1);
});

test("shared Kucher Point account without payer INN stays unresolved", () => {
  const sharedMapping = OZON_PAYOUT_MAPPINGS[1];
  const result = classifyOzonReceipts([{ ...base, accountId: sharedMapping.accountId }], sharedMapping);
  assert.equal(result.confirmed.length, 0);
  assert.equal(result.unresolved.length, 1);
});

test("words Ozon or Internet Resheniya without exact identity stay unresolved", () => {
  const result = classifyOzonReceipts([{ ...base, name: "Ozon Интернет Решения" }], mapping);
  assert.equal(result.confirmed.length, 0);
  assert.equal(result.unresolved.length, 1);
});

test("wrong category never becomes a confirmed Ozon receipt", () => {
  const result = classifyOzonReceipts([{ ...base, category: "Прочие поступления", accountId: mapping.accountId }], mapping);
  assert.equal(result.confirmed.length, 0);
  assert.equal(result.unresolved.length, 0);
});

test("report identity does not rotate when period boundaries change", () => {
  assert.equal(stableOzonReportKey(mapping.cabinetId, "report-42"), stableOzonReportKey(mapping.cabinetId, "report-42"));
});

test("unresolved marketplace receipt fails closed", () => {
  const result = buildOzonPayoutPreview({ reports: [{ amount: 100 }], confirmedReceipts: [], unresolvedReceipts: [{}], schedule: [{ date: "2026-08-01" }] });
  assert.deepEqual(result, { reportTotal: null, bankReceived: null, remaining: null, schedule: null });
});

test("authoritative report total is not capped by another forecast", () => {
  const result = buildOzonPayoutPreview({ reports: [{ amount: 100_000 }], confirmedReceipts: [{ amount: 10_000 }], unresolvedReceipts: [], schedule: [] });
  assert.equal(result.reportTotal, 100_000);
  assert.equal(result.remaining, 90_000);
});
