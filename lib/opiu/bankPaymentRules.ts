export function mandatoryBankCategory(row: { amount: number; counterpartyInn?: string; purpose?: string }): string | null {
  const purpose = (row.purpose ?? "").toLowerCase().replace(/[.,;:«»"']/g, " ").replace(/\s+/g, " ").trim();
  return row.amount > 0 && row.counterpartyInn?.replace(/\D/g, "") === "7704217370"
    && /оплата за тов(?:ар(?:ы|а)?)? по дог(?:овору)? ир(?:\s|$)/.test(purpose)
    ? "Продажи на МП" : null;
}
