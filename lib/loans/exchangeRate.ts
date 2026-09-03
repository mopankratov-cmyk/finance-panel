// Курс ЦБ РФ на сегодня. Одна функция для роута /api/opiu/exchange-rate и
// серверного распознавания договора — раньше браузер запрашивал курс сам.

const CBR_IDS: Record<string, string> = { USD: "R01235", EUR: "R01239", CNY: "R01375" };

export interface ExchangeRateResult {
  currency: string;
  rate: number;
  date: string;
  source: string;
}

export function isSupportedCurrency(currency: string): boolean {
  return currency === "RUB" || Boolean(CBR_IDS[currency]);
}

export async function fetchCbrRate(currencyInput: string): Promise<ExchangeRateResult> {
  const currency = currencyInput.toUpperCase();
  if (currency === "RUB") return { currency, rate: 1, date: new Date().toISOString().slice(0, 10), source: "RUB" };
  if (!CBR_IDS[currency]) throw new Error("Неподдерживаемая валюта");
  const response = await fetch("https://www.cbr.ru/scripts/XML_daily.asp", { cache: "no-store" });
  if (!response.ok) throw new Error("Банк России не вернул курс");
  const xml = await response.text();
  const block = xml.match(new RegExp(`<Valute ID="${CBR_IDS[currency]}">([\\s\\S]*?)</Valute>`))?.[1];
  const nominal = Number(block?.match(/<Nominal>([^<]+)<\/Nominal>/)?.[1] ?? 1);
  const value = Number((block?.match(/<Value>([^<]+)<\/Value>/)?.[1] ?? "").replace(",", "."));
  const date = xml.match(/Date="([^"]+)"/)?.[1] ?? "";
  if (!block || !Number.isFinite(value)) throw new Error("Курс валюты не найден");
  return { currency, rate: value / nominal, date, source: "Банк России" };
}
