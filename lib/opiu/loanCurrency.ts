import type { Payment } from "@/lib/types";

export const roundToTenth = (value: number): number => Math.round((Number(value) + Number.EPSILON) * 10) / 10;

export function loanCommentValue(comment: string | undefined, key: string): string {
  return comment?.match(new RegExp(`\\[${key}:([^\\]]*)\\]`))?.[1] ?? "";
}

export function setLoanCommentValue(comment: string | undefined, key: string, value: string | number): string {
  const marker = `[${key}:${value}]`;
  const pattern = new RegExp(`\\s*\\[${key}:[^\\]]*\\]`, "g");
  const clean = (comment ?? "").replace(pattern, "").trim();
  return `${clean}${clean ? " " : ""}${marker}`;
}

export function originalLoanPaymentAmount(payment: Pick<Payment, "amount" | "comment">, fallbackRate = 1): number {
  const rawSaved = loanCommentValue(payment.comment, "amount-original");
  const saved = Number(rawSaved);
  if (rawSaved !== "" && Number.isFinite(saved) && saved >= 0) return saved;
  const safeRate = Number.isFinite(fallbackRate) && fallbackRate > 0 ? fallbackRate : 1;
  return Math.abs(payment.amount) / safeRate;
}

export function recalculatePlannedLoanPayment(
  payment: Payment,
  currentRate: number,
  rateDate: string,
): Payment | null {
  if (payment.status !== "planned" || !/\[loan:[^:\]]+:schedule:/.test(payment.comment ?? "")) return null;
  const currency = loanCommentValue(payment.comment, "currency");
  if (!currency || currency === "RUB" || !Number.isFinite(currentRate) || currentRate <= 0) return null;
  const savedRate = Number(loanCommentValue(payment.comment, "fx-rate")) || 1;
  const original = originalLoanPaymentAmount(payment, savedRate);
  let comment = setLoanCommentValue(payment.comment, "amount-original", original);
  comment = setLoanCommentValue(comment, "amount-currency", currency);
  comment = setLoanCommentValue(comment, "fx-rate-current", currentRate);
  comment = setLoanCommentValue(comment, "fx-rate-date", rateDate);
  return { ...payment, amount: payment.amount < 0 ? -roundToTenth(original * currentRate) : roundToTenth(original * currentRate), comment };
}
