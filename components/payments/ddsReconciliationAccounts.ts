import { accountBalance } from "@/lib/finance/balance";
import { isDdsActualPayment } from "@/lib/finance/bankDdsPayment";
import type { Account, Payment } from "@/lib/types";

/** Счёт-источник строки банковской выписки всегда должен быть банковским. */
export function bankStatementSourceAccounts(accounts: readonly Account[]) {
  return accounts.filter((account) => account.type === "bank");
}

/**
 * Строки блока «Кошельки в ДДС». Календарные и технические кошельки без
 * фактов ДДС сюда не попадают; остаток считается тем же способом, что и на
 * экране счетов, а не берётся из устаревшего поля account.balance.
 */
export function ddsReconciliationAccountRows(accounts: readonly Account[], payments: readonly Payment[], asOf: string) {
  const facts = payments.filter(isDdsActualPayment);
  const usedAccountIds = new Set(facts.map((payment) => payment.accountId));
  return accounts
    .filter((account) => usedAccountIds.has(account.id))
    .map((account) => ({ account, balance: accountBalance(account, facts, asOf) }));
}

