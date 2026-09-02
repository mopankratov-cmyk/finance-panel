import type { Payment } from "@/lib/types";

const LOAN_SCHEDULE_MARKER = /\[loan:([^:\]]+):schedule:([^:\]]+):(principal|interest|penalty|fine)\]/;
const ORIGINAL_DUE_MARKER = /\s*\[original-due:[^\]]+\]/g;
const OVERDUE_CALENDAR_DATE_MARKER = /\s*\[overdue-calendar-date:[^\]]+\]/g;

export interface OverdueLoanInstallment {
  key: string;
  dueDate: string;
  originalDueDate: string | null;
  payments: Payment[];
  total: number;
}

export function loanScheduleKey(payment: Pick<Payment, "comment">): string | null {
  const match = payment.comment?.match(LOAN_SCHEDULE_MARKER);
  return match ? `${match[1]}:${match[2]}` : null;
}

function withOriginalDueDate(comment: string | undefined, dueDate: string): string {
  if (comment?.match(ORIGINAL_DUE_MARKER)) return comment;
  return `${comment ?? ""}${comment ? " " : ""}[original-due:${dueDate}]`;
}

function withOverdueCalendarDate(comment: string | undefined, targetDate: string): string {
  const clean = (comment ?? "").replace(OVERDUE_CALENDAR_DATE_MARKER, "").trim();
  return `${clean}${clean ? " " : ""}[overdue-calendar-date:${targetDate}]`;
}

function overdueCalendarDate(payment: Pick<Payment, "comment">): string | null {
  return payment.comment?.match(/\[overdue-calendar-date:([^\]]+)\]/)?.[1] ?? null;
}

export function rescheduleLoanInstallment(
  payments: Payment[],
  sourcePayment: Payment,
  targetDate: string,
): Payment[] {
  const key = loanScheduleKey(sourcePayment);
  if (!key || !targetDate || targetDate === sourcePayment.date) return [sourcePayment];
  return payments
    .filter((payment) => loanScheduleKey(payment) === key && payment.status === "planned")
    .map((payment) => ({
      ...payment,
      date: targetDate,
      comment: withOriginalDueDate(payment.comment, payment.date),
    }));
}

export function isLoanInstallmentAwaitingReschedule(payment: Payment, today: string): boolean {
  if (payment.status !== "planned" || !loanScheduleKey(payment) || payment.comment?.includes("[paid-by:")) return false;
  if (payment.date < today) return true;
  const originalDue = originalLoanDueDate(payment);
  return Boolean(originalDue && originalDue < today && overdueCalendarDate(payment) !== payment.date);
}

export function overdueLoanInstallmentsForReview(payments: Payment[], today: string): OverdueLoanInstallment[] {
  const groups = new Map<string, Payment[]>();
  for (const payment of payments) {
    if (!isLoanInstallmentAwaitingReschedule(payment, today)) continue;
    const key = loanScheduleKey(payment)!;
    groups.set(key, [...(groups.get(key) ?? []), payment]);
  }
  return [...groups.entries()].map(([key, parts]) => {
    const originalDates = parts.map(originalLoanDueDate).filter((date): date is string => Boolean(date)).sort();
    const currentDates = parts.map((payment) => payment.date).sort();
    const dueDate = currentDates[0] < today ? currentDates[0] : originalDates[0] ?? currentDates[0];
    return {
      key,
      dueDate,
      originalDueDate: originalDates[0] ?? null,
      payments: parts.sort((left, right) => left.category.localeCompare(right.category, "ru")),
      total: parts.reduce((sum, payment) => sum + Math.abs(payment.amount), 0),
    };
  }).sort((left, right) => left.dueDate.localeCompare(right.dueDate) || left.key.localeCompare(right.key));
}

export function rescheduleOverdueLoanInstallment(
  payments: Payment[],
  installment: OverdueLoanInstallment,
  targetDate: string,
  today: string,
): Payment[] {
  if (!targetDate || targetDate < today) return [];
  return payments
    .filter((payment) => loanScheduleKey(payment) === installment.key && payment.status === "planned")
    .map((payment) => ({
      ...payment,
      date: targetDate,
      comment: withOverdueCalendarDate(withOriginalDueDate(payment.comment, installment.dueDate), targetDate),
    }));
}

export function originalLoanDueDate(payment: Pick<Payment, "comment">): string | null {
  return payment.comment?.match(/\[original-due:([^\]]+)\]/)?.[1] ?? null;
}
