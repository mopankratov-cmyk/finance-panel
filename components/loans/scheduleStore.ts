"use client";

import type { ScheduleRowRecord } from "@/lib/loans/scheduleRows";
import type { LoanTerms, ScheduleRow } from "@/lib/loans/scheduleModel";
import type { Payment } from "@/lib/types";

async function json<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || `Ошибка ${response.status}`);
  return body;
}

/** Все строки графиков (или одного кредита). До миграции — пусто, `missingTable: true`. */
export async function loadLoanScheduleRows(loanId?: string): Promise<{ rows: ScheduleRowRecord[]; missingTable: boolean }> {
  const result = await fetch(`/api/finance/loans/schedule${loanId ? `?loan=${encodeURIComponent(loanId)}` : ""}`, { cache: "no-store" })
    .then((response) => json<{ rows: ScheduleRowRecord[]; missingTable?: boolean }>(response));
  return { rows: result.rows, missingTable: Boolean(result.missingTable) };
}

/** Расчёт графика от условий договора — предпросмотр, без записи. */
export async function buildLoanScheduleRows(terms: LoanTerms): Promise<ScheduleRow[]> {
  return fetch("/api/finance/loans/schedule", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "build", terms }) })
    .then((response) => json<{ rows: ScheduleRow[] }>(response)).then((result) => result.rows);
}

export interface SaveScheduleInput {
  loanId: string;
  accountId: string;
  companyId: string | null;
  currency: string;
  exchangeRate: number;
  creditorName: string;
  contractFileName?: string;
  rows: Array<{ id?: string; dueDate: string; kind: "principal" | "interest" | "penalty" | "fine" | "fee"; amountRub: number; amountOriginal?: number | null; balanceBefore?: number | null; balanceAfter?: number | null; status?: "planned" | "paid" | "cancelled" }>;
}

/** Заменить плановые строки графика; оплаченные и отменённые не трогаются. Возвращает строки и производные платежи. */
export async function saveLoanScheduleRows(input: SaveScheduleInput): Promise<{ rows: ScheduleRowRecord[]; payments: Payment[] }> {
  return fetch("/api/finance/loans/schedule", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) })
    .then((response) => json<{ rows: ScheduleRowRecord[]; payments: Payment[] }>(response));
}

/** Закрыть строки одной даты (тело + проценты…) одним фактом ДДС. confirmed=true — сумма отличается, человек подтвердил. */
export async function closeLoanScheduleRows(rowIds: string[], factId: string, confirmed = false): Promise<ScheduleRowRecord[]> {
  return fetch("/api/finance/loans/schedule", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rowIds, factId, confirmed }) })
    .then((response) => json<{ rows: ScheduleRowRecord[] }>(response)).then((result) => result.rows);
}
