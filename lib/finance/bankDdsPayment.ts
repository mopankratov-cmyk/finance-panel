import type { Account, Payment } from "@/lib/types";

/** Факт ДДС: банковская выписка, её разбивка или ручная операция наличными. */
export function isDdsActualPayment(payment: Pick<Payment, "status" | "importSource">) {
  if (payment.status !== "done") return false;
  return /^(?:bank-review|dds-chain|manual-dds):/i.test(payment.importSource ?? "");
}

export function isManualDdsPayment(payment: Pick<Payment, "importSource">) {
  return /^manual-dds:/i.test(payment.importSource ?? "");
}

/** Наличные кошельки для ручного факта; чисто календарные счета исключаются. */
export function manualDdsCashAccounts(accounts: Account[], payments: Payment[]) {
  const calendarOnlyAccountIds = new Set(accounts.flatMap((account) => {
    const rows = payments.filter((payment) => payment.accountId === account.id);
    const onlyCalendarRows = rows.length > 0 && rows.every((payment) =>
      payment.status === "planned" || /\[loan:[^\]]+:schedule:/.test(payment.comment ?? ""),
    );
    return onlyCalendarRows ? [account.id] : [];
  }));
  return accounts.filter((account) => account.type === "cash" && !calendarOnlyAccountIds.has(account.id));
}
