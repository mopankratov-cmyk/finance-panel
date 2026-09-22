import { isDdsActualPayment } from "@/lib/finance/bankDdsPayment";
import type { Payment } from "@/lib/types";

export interface LoanPaymentCandidate {
  payment: Payment;
  amountDifference: number;
  daysDifference: number;
  sameCompany: boolean;
}

function calendarDaysBetween(left: string, right: string) {
  const leftTime = Date.parse(`${left}T12:00:00Z`);
  const rightTime = Date.parse(`${right}T12:00:00Z`);
  return Number.isFinite(leftTime) && Number.isFinite(rightTime)
    ? Math.abs(leftTime - rightTime) / 86_400_000
    : Number.MAX_SAFE_INTEGER;
}

/**
 * Факты для ручной привязки к графику кредита. Тип кошелька намеренно не
 * проверяется: оплата с наличных — такой же факт ДДС, как списание из банка.
 */
export function loanPaymentCandidates(
  payments: readonly Payment[],
  consumedPaymentIds: ReadonlySet<string>,
  paymentCompanyIds: ReadonlyMap<string, string | null>,
  expectedCompanyId: string | null,
  expectedAmount: number,
  expectedDate: string,
): LoanPaymentCandidate[] {
  return payments
    .filter((payment) => isDdsActualPayment(payment) && payment.amount < 0 && !consumedPaymentIds.has(payment.id))
    .map((payment) => ({
      payment,
      amountDifference: Math.abs(Math.abs(payment.amount) - expectedAmount),
      daysDifference: calendarDaysBetween(payment.date, expectedDate),
      sameCompany: !expectedCompanyId || paymentCompanyIds.get(payment.id) === expectedCompanyId,
    }))
    .sort((left, right) =>
      Number(right.sameCompany) - Number(left.sameCompany)
      || left.amountDifference - right.amountDifference
      || left.daysDifference - right.daysDifference
      || right.payment.date.localeCompare(left.payment.date));
}

export function requiresLoanAmountConfirmation(actualAmount: number, expectedAmount: number) {
  return Math.abs(Math.abs(actualAmount) - expectedAmount) > Math.max(0.01, expectedAmount * 0.01);
}
