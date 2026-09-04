// Строки графика кредита (таблица loan_schedule_rows) ↔ черновик формы и
// производные плановые платежи календаря. Источник правды — строки; платёж
// в payments несёт прежнюю метку [loan:<id>:schedule:<rowId>:<kind>], чтобы
// календарь, сверка и Google-выгрузка продолжали работать без правок.

import { LOAN_CATEGORIES } from "@/lib/finance/categories";
import type { Payment } from "@/lib/types";
import type { LoanScheduleDraft } from "./schedule";

export type ScheduleRowKind = "principal" | "interest" | "penalty" | "fine" | "fee";
export type ScheduleRowStatus = "planned" | "paid" | "cancelled";

export interface ScheduleRowRecord {
  id: string;
  loanId: string;
  dueDate: string;
  kind: ScheduleRowKind;
  amountRub: number;
  amountOriginal: number | null;
  currency: string;
  status: ScheduleRowStatus;
  paidByPaymentId: string | null;
  calendarPaymentId: string | null;
  originalDueDate: string | null;
  balanceBefore: number | null;
  balanceAfter: number | null;
}

export function scheduleRowFromDb(row: Record<string, unknown>): ScheduleRowRecord {
  const kind = String(row.kind);
  const status = String(row.status);
  return {
    id: String(row.id),
    loanId: String(row.loan_id),
    dueDate: String(row.due_date).slice(0, 10),
    kind: (["principal", "interest", "penalty", "fine", "fee"].includes(kind) ? kind : "interest") as ScheduleRowKind,
    amountRub: Number(row.amount_rub ?? 0),
    amountOriginal: row.amount_original == null ? null : Number(row.amount_original),
    currency: String(row.currency ?? "RUB"),
    status: (["planned", "paid", "cancelled"].includes(status) ? status : "planned") as ScheduleRowStatus,
    paidByPaymentId: row.paid_by_payment_id ? String(row.paid_by_payment_id) : null,
    calendarPaymentId: row.calendar_payment_id ? String(row.calendar_payment_id) : null,
    originalDueDate: row.original_due_date ? String(row.original_due_date).slice(0, 10) : null,
    balanceBefore: row.balance_before == null ? null : Number(row.balance_before),
    balanceAfter: row.balance_after == null ? null : Number(row.balance_after),
  };
}

/** Строки одного кредита → черновик формы: одна запись на дату с телом/процентами/пенями/штрафами. */
export function scheduleDraftFromRows(rows: readonly ScheduleRowRecord[]): LoanScheduleDraft[] {
  const byDate = new Map<string, LoanScheduleDraft & { statuses: ScheduleRowStatus[] }>();
  for (const row of [...rows].sort((a, b) => a.dueDate.localeCompare(b.dueDate))) {
    const current = byDate.get(row.dueDate) ?? {
      id: row.dueDate, date: row.dueDate, principal: 0, interest: 0, penalty: 0, fine: 0,
      principalOriginal: 0, interestOriginal: 0, penaltyOriginal: 0, fineOriginal: 0, status: "planned", statuses: [],
      balanceBefore: row.balanceBefore ?? undefined, balanceAfter: row.balanceAfter ?? undefined,
    };
    const kind = row.kind === "fee" ? "penalty" : row.kind;
    current[kind] += row.amountRub;
    current[`${kind}Original` as "principalOriginal" | "interestOriginal" | "penaltyOriginal" | "fineOriginal"] =
      (current[`${kind}Original` as "principalOriginal"] ?? 0) + (row.amountOriginal ?? row.amountRub);
    current.statuses.push(row.status);
    if (row.balanceAfter != null) current.balanceAfter = row.balanceAfter;
    if (row.balanceBefore != null && current.balanceBefore == null) current.balanceBefore = row.balanceBefore;
    byDate.set(row.dueDate, current);
  }
  return [...byDate.values()].map(({ statuses, ...draft }) => ({
    ...draft,
    status: statuses.every((status) => status === "paid") ? "done" : statuses.some((status) => status === "planned") ? "planned" : "cancelled",
  }));
}

export interface DerivedPaymentInput {
  loanId: string;
  creditorName: string;
  accountId: string;
  currency: string;
  exchangeRate: number;
  contractFileName?: string;
}

const CATEGORY_BY_KIND: Record<ScheduleRowKind, string> = {
  principal: LOAN_CATEGORIES.principal,
  interest: LOAN_CATEGORIES.interest,
  penalty: LOAN_CATEGORIES.penalty,
  fine: LOAN_CATEGORIES.fine,
  fee: LOAN_CATEGORIES.penalty,
};
const NAME_BY_KIND: Record<ScheduleRowKind, string> = {
  principal: "Погашение тела", interest: "Проценты по кредиту", penalty: "Пени и штрафы", fine: "Штраф по кредиту", fee: "Комиссия по кредиту",
};

/** Плановый платёж календаря, производный от строки графика. */
export function derivedPaymentForRow(row: ScheduleRowRecord, input: DerivedPaymentInput, existingId?: string): Payment {
  const markerKind = row.kind === "fee" ? "penalty" : row.kind;
  const original = row.amountOriginal ?? row.amountRub / (input.exchangeRate || 1);
  return {
    id: existingId ?? row.calendarPaymentId ?? crypto.randomUUID(),
    date: row.dueDate,
    name: `${NAME_BY_KIND[row.kind]} — ${input.creditorName}`,
    amount: -Math.abs(row.amountRub),
    category: CATEGORY_BY_KIND[row.kind],
    accountId: input.accountId,
    status: row.status === "paid" ? "cancelled" : row.status === "cancelled" ? "cancelled" : "planned",
    counterparty: input.creditorName,
    comment: [
      `[loan:${input.loanId}:schedule:${row.id}:${markerKind}]`,
      `[currency:${input.currency}]`, `[fx-rate:${input.exchangeRate}]`,
      `[amount-original:${Math.round(original * 100) / 100}]`, `[amount-currency:${input.currency}]`,
      row.paidByPaymentId ? `[paid-by:${row.paidByPaymentId}]` : "",
      row.originalDueDate ? `[original-due:${row.originalDueDate}]` : "",
      input.contractFileName ? `[contract:${input.contractFileName}]` : "",
    ].filter(Boolean).join(" "),
  };
}

export interface CloseRowCheck {
  ok: boolean;
  reason?: string;
}

/** Можно ли закрыть строку фактом: факт существует, расход, никем не занят, сумма совпадает или подтверждено вручную (I1, I2). */
export function canCloseRowWithFact(
  row: ScheduleRowRecord,
  fact: Pick<Payment, "id" | "status" | "amount"> | undefined,
  consumedFactIds: ReadonlySet<string>,
  confirmed: boolean,
): CloseRowCheck {
  if (row.status !== "planned") return { ok: false, reason: "Строка графика уже закрыта" };
  if (!fact || fact.status !== "done" || fact.amount >= 0) return { ok: false, reason: "Факт не найден или это не расход" };
  if (consumedFactIds.has(fact.id)) return { ok: false, reason: "Этот факт уже закрывает другое обязательство" };
  const delta = Math.abs(Math.abs(fact.amount) - row.amountRub);
  if (delta > Math.max(0.01, row.amountRub * 0.01) && !confirmed) return { ok: false, reason: "Сумма факта отличается от строки — нужно подтверждение" };
  return { ok: true };
}
