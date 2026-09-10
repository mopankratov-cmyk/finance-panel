import type { Account } from "@/lib/types";

/** Основной кошелёк календаря: не зависит от порядка, в котором счета вернула база. */
export function defaultCalendarAccountId(accounts: Account[]): string {
  return accounts.find((account) => account.name.trim().toLowerCase() === "pankster group")?.id ?? accounts[0]?.id ?? "";
}
