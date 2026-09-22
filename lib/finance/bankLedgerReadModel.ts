import type { Payment } from "@/lib/types";

export type BankAllocationReadRow = {
  payment_id: string;
  amount: number;
  operation_date: string;
  category: string;
  account_id: string;
  company_id: string | null;
  counterparty: string;
  status: "done" | "cancelled";
};

type PaymentWithSource = Payment & { importSource?: string | null };

const isBankPayment = (payment: PaymentWithSource) =>
  /^(bank-review|dds-chain):/.test(payment.importSource ?? "")
  && (payment.status === "done" || payment.status === "cancelled");

/**
 * На переходном этапе payments остаётся оболочкой для интерфейса: в ней живут
 * название, комментарий и стабильный id для редактирования. Денежные поля
 * проведённого банковского факта уже берутся из канонической allocation.
 *
 * Плановые, наличные и прочие ручные платежи в ledger не входят и возвращаются
 * без изменений. Банковская строка без allocation тоже остаётся видимой: это
 * может быть план, неполная классификация или окружение до миграции.
 */
export function applyBankLedgerReadModel<T extends PaymentWithSource>(
  payments: T[],
  allocations: BankAllocationReadRow[],
): T[] {
  const allocationByPaymentId = new Map(allocations.map((row) => [row.payment_id, row]));
  return payments.map((payment) => {
    if (!isBankPayment(payment)) return payment;
    const allocation = allocationByPaymentId.get(payment.id);
    if (!allocation) return payment;
    return {
      ...payment,
      amount: Number(allocation.amount),
      date: allocation.operation_date,
      category: allocation.category,
      accountId: allocation.account_id,
      companyId: allocation.company_id,
      counterparty: allocation.counterparty,
      status: allocation.status,
    };
  });
}
