import type { Payment } from "@/lib/types";

export const PAYROLL_FACT_MARKER = "payroll-paid";

export function appendPayrollFactMarker(comment: string | null | undefined, factId: string): string {
  const marker = `[${PAYROLL_FACT_MARKER}:${factId}]`;
  const current = (comment ?? "").trim();
  if (current.includes(marker)) return current;
  return `${current} ${marker}`.trim();
}

export function canAllocateFactToPayroll(
  factId: string,
  consumedFactIds: ReadonlySet<string>,
  existingPayrollAllocation: number,
): boolean {
  return !consumedFactIds.has(factId) || existingPayrollAllocation > 0;
}

export function employeeDebt(accrued: number | null, confirmedPayments: number): number | null {
  if (accrued === null) return null;
  return Math.max(0, Math.round((accrued - confirmedPayments) * 100) / 100);
}

export function payrollCategoryForEmployee(position: string): "administrative" | "commercial" | "production" {
  const value = position.toLowerCase();
  if (/(склад|фулфил|производ|упаков|комплектов)/.test(value)) return "production";
  if (/(продаж|маркет|wildberries|ozon|менеджер\s+(?:wb|мп)|продуктолог|реклам)/.test(value)) return "commercial";
  return "administrative";
}

export function paymentIsPayrollCandidate(payment: Pick<Payment, "status" | "amount" | "date">, cutoff = "2026-09-01"): boolean {
  return payment.status === "done" && payment.amount < 0 && payment.date >= cutoff;
}
