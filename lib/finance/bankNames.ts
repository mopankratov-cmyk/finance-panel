export function bankNameFromWalletName(walletName: string | null | undefined, fallback = "Банковская выписка") {
  const value = (walletName ?? "").toLowerCase().replace(/ё/g, "е");
  if (/\bozon\b|озон/.test(value)) return "Ozon Банк";
  if (/точк/.test(value)) return "Банк Точка";
  if (/\bт[- ]?банк\b|тинькофф/.test(value)) return "Т-Банк";
  if (/сбер/.test(value)) return "СберБанк";
  if (/\bвб\b|wildberries|вайлдберриз/.test(value)) return "ВБ Банк";
  return fallback;
}
