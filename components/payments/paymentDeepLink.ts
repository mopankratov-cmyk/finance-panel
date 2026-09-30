export function shouldOpenCompanySettings(search: string): boolean {
  return new URLSearchParams(search).get("companies") === "1";
}

export function shouldOpenBankImport(search: string): boolean {
  return new URLSearchParams(search).get("bankImport") === "1";
}

/** ID факта, который нужно подсветить после перехода из другого финансового модуля. */
export function paymentIdFromSearch(search: string): string | null {
  const value = new URLSearchParams(search).get("payment")?.trim() ?? "";
  return value && value.length <= 128 ? value : null;
}

export type PaymentLedgerFilters = { from: string; to: string; company: string; cashout: boolean };

/** Фильтры реестра ДДС для перехода из сводных финансовых разделов. */
export function paymentLedgerFiltersFromSearch(search: string): PaymentLedgerFilters | null {
  const params = new URLSearchParams(search);
  if (params.get("cashout") !== "1") return null;
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const company = params.get("company")?.trim() ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to || company.length > 128) return null;
  return { from, to, company, cashout: true };
}
