const normalize = (value: string) => value
  .toLowerCase()
  .replace(/ё/g, "е")
  .replace(/[^а-яa-z0-9]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

export function mandatoryBankCategory(row: {
  amount: number;
  counterparty?: string;
  counterpartyInn?: string;
  purpose?: string;
}): string | null {
  const purpose = normalize(row.purpose ?? "");
  const counterparty = normalize(row.counterparty ?? "");
  const counterpartyInn = row.counterpartyInn?.replace(/\D/g, "") ?? "";

  const isInternetResheniya = counterpartyInn === "7704217370"
    || /(?:^| )интернет решения(?: |$)/.test(counterparty);
  const isMarketplaceGoodsPayment = /оплата за тов(?:ар(?:ы|а)?)? по дог(?:овору)? ир(?: |$)/.test(purpose);
  if (row.amount > 0 && isInternetResheniya && isMarketplaceGoodsPayment) return "Продажи на МП";

  const isEnp = /(?:^| )енп(?: |$)/.test(purpose)
    || /(?:^| )единый налоговый платеж(?: |$)/.test(purpose);
  if (row.amount < 0 && isEnp) return "УСН";

  return null;
}
