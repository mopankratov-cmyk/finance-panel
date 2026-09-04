// Остаток счёта — из остатка на дату открытия и фактических платежей.
// Единственное место, где считается остаток: календарь, дашборд, «Счета» и
// «Финансовый контроль» зовут эти функции, а не складывают accounts.balance.

import type { Account, Payment } from "@/lib/types";

/** Счёт, у которого остаток ведётся по платежам (есть дата открытия). */
export function hasOpening(account: Pick<Account, "openingDate">): boolean {
  return Boolean(account.openingDate);
}

/** Только рублёвые счета — валютные в рублёвый прогноз не складываются. */
export function rubAccounts<T extends Pick<Account, "currency">>(accounts: readonly T[]): T[] {
  return accounts.filter((account) => account.currency === "RUB");
}

/**
 * Остаток счёта на конец дня asOf: остаток на дату открытия плюс все
 * фактические платежи по счёту с opening_date по asOf включительно.
 * Без даты открытия — старое ручное число balance (переходный режим).
 */
export function accountBalance(account: Account, payments: readonly Payment[], asOf: string): number {
  if (!account.openingDate) return account.balance;
  let total = account.openingBalance ?? 0;
  for (const payment of payments) {
    if (payment.accountId !== account.id || payment.status !== "done") continue;
    if (payment.date < account.openingDate || payment.date > asOf) continue;
    total += payment.amount;
  }
  return total;
}

/** Сумма остатков рублёвых счетов на конец дня asOf. */
export function totalRubBalance(accounts: readonly Account[], payments: readonly Payment[], asOf: string): number {
  return rubAccounts(accounts).reduce((sum, account) => sum + accountBalance(account, payments, asOf), 0);
}

/**
 * Прогноз остатка на день `day`: факты до min(day, today) плюс планы в
 * (today, day]. Прошлое не переписывается новыми планами; будущий факт
 * (оплачено заранее) не считается дважды.
 */
export function projectedBalance(accounts: readonly Account[], payments: readonly Payment[], today: string, day: string): number {
  const rub = rubAccounts(accounts);
  const rubIds = new Set(rub.map((account) => account.id));
  const factsUntil = day < today ? day : today;
  let total = rub.reduce((sum, account) => sum + accountBalance(account, payments, factsUntil), 0);
  if (day > today) {
    for (const payment of payments) {
      if (payment.status !== "planned" || !rubIds.has(payment.accountId)) continue;
      if (payment.date > today && payment.date <= day) total += payment.amount;
    }
  }
  return total;
}
