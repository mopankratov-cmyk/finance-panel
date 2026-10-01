export function bankNameFromWalletName(walletName: string | null | undefined, fallback = "Банковская выписка") {
  const value = (walletName ?? "").toLowerCase().replace(/ё/g, "е");
  // Имя файла выписки Точки содержит БИК, даже когда в самой таблице нет
  // названия банка. БИК надёжнее введённого вручную имени кошелька: так
  // ошибочно названный «WB банк» не превращает выписку Точки в выписку ВБ.
  if (/044525104/.test(value)) return "Банк Точка";
  if (/\bozon\b|озон/.test(value)) return "Ozon Банк";
  if (/точк/.test(value)) return "Банк Точка";
  if (/\bт[- ]?банк\b|тинькофф/.test(value)) return "Т-Банк";
  if (/сбер/.test(value)) return "СберБанк";
  if (/(?:^|[^а-яa-z0-9])(?:вб|wb)(?:$|[^а-яa-z0-9])|wildberries|вайлдберриз/.test(value)) return "ВБ Банк";
  if (/альфа/.test(value)) return "Альфа-Банк";
  return fallback;
}
