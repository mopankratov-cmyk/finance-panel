import assert from "node:assert/strict";
import test from "node:test";
import { importedMonths, plannedPaymentsToReplace } from "../../components/calendar/calendarReplace.ts";
import type { Payment } from "../types.ts";

const plan = (id: string, date: string, amount: number): Payment => ({ id, date, amount, status: "planned", name: id, category: "Прочее", accountId: "a", counterparty: "" });
const payments: Payment[] = [
  plan("oct-1", "2026-10-05", -100),
  plan("oct-2", "2026-10-20", 500),
  plan("nov-1", "2026-11-05", -100),
  { ...plan("oct-done", "2026-10-07", -100), status: "done" },
];
const links = new Map<string, string | null>([["oct-1", "c-1"], ["oct-2", "c-1"], ["nov-1", "c-1"], ["oct-done", "c-1"]]);

test("заменяются только планы тех месяцев, что есть в файле", () => {
  const months = importedMonths([{ date: "2026-10-01" }, { date: "2026-10-31" }]);
  const ids = plannedPaymentsToReplace(payments, links, { companyId: "c-1", scope: "all", months }).map((payment) => payment.id);
  assert.deepEqual(ids.sort(), ["oct-1", "oct-2"]);
});

test("тип потока и компания сужают выборку; факты не трогаются", () => {
  const months = importedMonths([{ date: "2026-10-01" }]);
  assert.deepEqual(plannedPaymentsToReplace(payments, links, { companyId: "c-1", scope: "expenses", months }).map((p) => p.id), ["oct-1"]);
  assert.deepEqual(plannedPaymentsToReplace(payments, links, { companyId: "c-1", scope: "income", months }).map((p) => p.id), ["oct-2"]);
  assert.deepEqual(plannedPaymentsToReplace(payments, links, { companyId: "c-2", scope: "all", months }), []);
  assert.deepEqual(plannedPaymentsToReplace(payments, links, { companyId: null, scope: "all", months }), [], "без компании — только планы без компании");
});

test("пустой файл ничего не удаляет", () => {
  assert.deepEqual(plannedPaymentsToReplace(payments, links, { companyId: "c-1", scope: "all", months: new Set() }), []);
});
