export function shouldOpenCompanySettings(search: string): boolean {
  return new URLSearchParams(search).get("companies") === "1";
}

/** ID факта, который нужно подсветить после перехода из другого финансового модуля. */
export function paymentIdFromSearch(search: string): string | null {
  const value = new URLSearchParams(search).get("payment")?.trim() ?? "";
  return value && value.length <= 128 ? value : null;
}
