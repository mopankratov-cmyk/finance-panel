import { isDdsActualPayment } from "@/lib/finance/bankDdsPayment";
import type { Payment } from "@/lib/types";

export interface LoanPaymentCandidate {
  payment: Payment;
  amountDifference: number;
  daysDifference: number;
  sameCompany: boolean;
  purposeScore: number;
}

function calendarDaysBetween(left: string, right: string) {
  const leftTime = Date.parse(`${left}T12:00:00Z`);
  const rightTime = Date.parse(`${right}T12:00:00Z`);
  return Number.isFinite(leftTime) && Number.isFinite(rightTime)
    ? Math.abs(leftTime - rightTime) / 86_400_000
    : Number.MAX_SAFE_INTEGER;
}

const GENERIC_LOAN_WORDS = new Set(["банк", "кредит", "кредита", "займ", "займа", "оплата", "платеж", "погашение", "договор"]);

/** Насколько назначение факта указывает на конкретного кредитора, а не просто содержит слово «займ». */
export function loanPurposeScore(payment: Pick<Payment, "name" | "counterparty" | "comment">, creditorName: string) {
  const normalize = (value: string) => value.toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9]+/g, " ").trim();
  const haystack = normalize(`${payment.name} ${payment.counterparty} ${payment.comment ?? ""}`);
  const creditor = normalize(creditorName);
  if (!creditor || !haystack) return 0;
  if (haystack.includes(creditor)) return 100;
  const contractNumber = creditorName.match(/\d{4,}(?:[-/]\d+)?/)?.[0]?.toLowerCase();
  if (contractNumber && haystack.includes(contractNumber)) return 95;
  const words = creditor.split(" ").filter((word) => word.length >= 4 && !GENERIC_LOAN_WORDS.has(word) && !/^\d+$/.test(word));
  const matched = words.filter((word) => haystack.includes(word)).length;
  return matched ? Math.round(80 * matched / words.length) : 0;
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
  creditorName = "",
): LoanPaymentCandidate[] {
  return payments
    .filter((payment) => isDdsActualPayment(payment) && payment.amount < 0 && !consumedPaymentIds.has(payment.id))
    .map((payment) => ({
      payment,
      amountDifference: Math.abs(Math.abs(payment.amount) - expectedAmount),
      daysDifference: calendarDaysBetween(payment.date, expectedDate),
      sameCompany: !expectedCompanyId || paymentCompanyIds.get(payment.id) === expectedCompanyId,
      purposeScore: loanPurposeScore(payment, creditorName),
    }))
    .sort((left, right) =>
      Number(right.sameCompany) - Number(left.sameCompany)
      || right.purposeScore - left.purposeScore
      || left.amountDifference - right.amountDifference
      || left.daysDifference - right.daysDifference
      || right.payment.date.localeCompare(left.payment.date));
}

export function requiresLoanAmountConfirmation(actualAmount: number, expectedAmount: number) {
  return Math.abs(Math.abs(actualAmount) - expectedAmount) > Math.max(0.01, expectedAmount * 0.01);
}
