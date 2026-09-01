import type { Payment } from "@/lib/types";

const LOAN_SCHEDULE_MARKER = /\[loan:([^:\]]+):schedule:([^:\]]+):(principal|interest|penalty|fine)\]/;
const ORIGINAL_DUE_MARKER = /\s*\[original-due:[^\]]+\]/g;

export function loanScheduleKey(payment: Pick<Payment, "comment">): string | null {
  const match = payment.comment?.match(LOAN_SCHEDULE_MARKER);
  return match ? `${match[1]}:${match[2]}` : null;
}

function withOriginalDueDate(comment: string | undefined, dueDate: string): string {
  if (comment?.match(ORIGINAL_DUE_MARKER)) return comment;
  return `${comment ?? ""}${comment ? " " : ""}[original-due:${dueDate}]`;
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

export function overdueLoanInstallmentsToMove(
  payments: Payment[],
  today: string,
  protectedPlanIds: Set<string>,
  protectedScheduleKeys: Set<string> = new Set(),
): Payment[] {
  const protectedKeys = new Set(
    payments
      .filter((payment) => protectedPlanIds.has(payment.id))
      .map(loanScheduleKey)
      .filter((key): key is string => Boolean(key)),
  );
  for (const key of protectedScheduleKeys) protectedKeys.add(key);
  const overdueKeys = new Set(
    payments
      .filter((payment) => payment.status === "planned" && payment.date < today && !payment.comment?.includes("[paid-by:"))
      .filter((payment) => !protectedPlanIds.has(payment.id))
      .map(loanScheduleKey)
      .filter((key): key is string => key !== null && !protectedKeys.has(key)),
  );

  return payments
    .filter((payment) => payment.status === "planned" && overdueKeys.has(loanScheduleKey(payment) ?? ""))
    .map((payment) => ({
      ...payment,
      date: today,
      comment: withOriginalDueDate(payment.comment, payment.date),
    }));
}

function normalized(value: string | undefined): string {
  return (value ?? "").toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9]+/g, " ").trim();
}

function dayDistance(left: string, right: string): number {
  return Math.abs((Date.parse(`${left}T00:00:00Z`) - Date.parse(`${right}T00:00:00Z`)) / 86_400_000);
}

export function loanScheduleKeysWithDdsCandidate(
  payments: Payment[],
  companyByPayment: Map<string, string | null>,
): Set<string> {
  const groups = new Map<string, Payment[]>();
  for (const payment of payments) {
    const key = loanScheduleKey(payment);
    if (!key || payment.status !== "planned") continue;
    groups.set(key, [...(groups.get(key) ?? []), payment]);
  }
  const actual = payments.filter((payment) => payment.status === "done" && payment.amount < 0 && !loanScheduleKey(payment));
  const protectedKeys = new Set<string>();
  for (const [key, parts] of groups) {
    const total = parts.reduce((sum, payment) => sum + Math.abs(payment.amount), 0);
    const dueDate = parts[0].date;
    const creditor = normalized(parts[0].counterparty || parts[0].name);
    const companyId = companyByPayment.get(parts[0].id) ?? null;
    const hasCandidate = actual.some((payment) => {
      if (companyId && companyByPayment.get(payment.id) !== companyId) return false;
      const actualText = normalized(`${payment.counterparty} ${payment.name}`);
      if (creditor && (!actualText || (!actualText.includes(creditor) && !creditor.includes(actualText)))) return false;
      return dayDistance(payment.date, dueDate) <= 14
        && Math.abs(Math.abs(payment.amount) - total) <= Math.max(1, total * 0.005);
    });
    if (hasCandidate) protectedKeys.add(key);
  }
  return protectedKeys;
}

export function originalLoanDueDate(payment: Pick<Payment, "comment">): string | null {
  return payment.comment?.match(/\[original-due:([^\]]+)\]/)?.[1] ?? null;
}
