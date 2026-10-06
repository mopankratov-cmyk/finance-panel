import type { Account } from "@/lib/types";

const normalize = (value: string) => value
  .toLocaleLowerCase("ru-RU")
  .replace(/ё/g, "е")
  .replace(/[^а-яa-z0-9]+/g, " ")
  .trim();

/**
 * Личные карты, которыми оплачивают расходы нескольких компаний.
 * Компания владельца карты не является владельцем каждого расхода.
 */
export function isSharedPersonalWalletName(value: string): boolean {
  const name = normalize(value);
  if (/^(?:карта )?(?:озон|ozon)(?: банк)?$/.test(name) || /(?:озон|ozon).*(?:карт|физ)/.test(name)) return true;
  if (/(?:т банк|тинькофф)/.test(name) && /(?:карт|физ|филиппов)/.test(name)) return true;
  return /сбер/.test(name) && /(?:карт|физ)/.test(name) && /(?:панкратов|максим)/.test(name);
}

export function sharedPersonalWalletIds(accounts: readonly Pick<Account, "id" | "name">[]) {
  return new Set(accounts.filter((account) => isSharedPersonalWalletName(account.name)).map((account) => account.id));
}
