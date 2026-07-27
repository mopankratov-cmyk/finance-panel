export type LoanCurrency = "RUB" | "USD" | "EUR" | "CNY";

export interface RecognizedScheduleRow {
  date: string;
  principal: number;
  interest: number;
  penalty?: number;
}

export interface RecognizedLoan {
  contractNumber: string;
  creditorName: string;
  companyHint: string;
  accountHint: string;
  principalAmount: number;
  currency: LoanCurrency;
  annualRate: number;
  originationFee: number;
  feeAmortizationMonths: number;
  startDate: string;
  dueDate: string;
  interestFrequency: "weekly" | "monthly" | "quarterly" | "at_maturity" | "unknown";
  confidence: number;
  warnings: string[];
  schedule?: RecognizedScheduleRow[];
}

const currencyByText: Array<[RegExp, LoanCurrency]> = [
  [/\b(usd|доллар(?:а|ов|ы)?|\$)\b/i, "USD"],
  [/\b(eur|евро|€)\b/i, "EUR"],
  [/\b(cny|юан(?:ь|я|ей|и)?|¥)\b/i, "CNY"],
];

function normalizeAmount(raw: string, multiplier = "") {
  const value = Number(raw.replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(value)) return 0;
  if (/млн|миллион/i.test(multiplier)) return value * 1_000_000;
  if (/тыс|тысяч/i.test(multiplier)) return value * 1_000;
  return value;
}

function isoDate(raw: string, fallbackYear: number) {
  const match = raw.match(/(\d{1,2})[.\-/](\d{1,2})(?:[.\-/](\d{2,4}))?/);
  if (!match) return "";
  const year = match[3] ? Number(match[3].length === 2 ? `20${match[3]}` : match[3]) : fallbackYear;
  return `${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

export function recognizeLoanText(text: string): RecognizedLoan {
  const clean = text.replace(/\s+/g, " ").trim();
  const now = new Date();
  const year = now.getFullYear();
  const currency = currencyByText.find(([pattern]) => pattern.test(clean))?.[1] ?? "RUB";
  const amountMatch = clean.match(/(\d[\d\s]*(?:[.,]\d+)?)\s*(млн|миллион(?:а|ов)?|тыс(?:яч[аи]?)?)?\s*(?:₽|руб(?:лей|ля)?|р\.|usd|доллар(?:а|ов|ы)?|\$|eur|евро|€|cny|юан(?:ь|я|ей|и)?|¥)/i);
  const rateMatch = clean.match(/(?:под|ставк[ае]?)?\s*(\d+(?:[.,]\d+)?)\s*%\s*(?:годовых|в\s*год)?/i);
  const startMatch = clean.match(/(?:от|получен\w*|выдан\w*|займ[^,;]*[,;]?)\s*(\d{1,2}[.\-/]\d{1,2}(?:[.\-/]\d{2,4})?)/i);
  const dueMatch = clean.match(/(?:тела|возврат\w*|погашен\w*|до)\s*(\d{1,2}[.\-/]\d{1,2}(?:[.\-/]\d{2,4})?)/i);
  const nameMatch = clean.match(/(?:займ|кредит)\s+([^,;]+?)(?=\s+\d{1,2}[.\-/]|\s+\d[\d\s]*(?:[.,]\d+)?\s*(?:тыс|млн|руб|доллар|usd|eur)|[,;]|$)/i);
  const startDate = isoDate(startMatch?.[1] ?? "", year);
  let dueDate = isoDate(dueMatch?.[1] ?? "", startDate ? Number(startDate.slice(0, 4)) : year);
  if (startDate && dueDate && dueDate < startDate && !/\d{4}/.test(dueMatch?.[1] ?? "")) {
    dueDate = `${Number(dueDate.slice(0, 4)) + 1}${dueDate.slice(4)}`;
  }
  const warnings: string[] = [];
  if (!nameMatch?.[1]) warnings.push("Не удалось уверенно определить кредитора");
  if (!amountMatch) warnings.push("Не удалось определить сумму займа");
  if (!rateMatch) warnings.push("Не удалось определить процентную ставку");
  if (!startDate) warnings.push("Не удалось определить дату получения");
  if (!dueDate) warnings.push("Не удалось определить дату возврата тела");

  return {
    contractNumber: "",
    creditorName: nameMatch?.[1]?.trim() ?? "",
    companyHint: "",
    accountHint: "",
    principalAmount: amountMatch ? normalizeAmount(amountMatch[1], amountMatch[2]) : 0,
    currency,
    annualRate: rateMatch ? Number(rateMatch[1].replace(",", ".")) : 0,
    originationFee: 0,
    feeAmortizationMonths: 36,
    startDate,
    dueDate,
    interestFrequency: /процент\w*\s+ежемесяч/i.test(clean)
      ? "monthly"
      : /процент\w*\s+(?:в\s+конце|при\s+погашении)/i.test(clean)
        ? "at_maturity"
        : "unknown",
    confidence: Math.max(20, 100 - warnings.length * 15),
    warnings,
  };
}

export function mergeRecognition(local: RecognizedLoan, remote?: Partial<RecognizedLoan>): RecognizedLoan {
  if (!remote) return local;
  return {
    ...local,
    ...Object.fromEntries(Object.entries(remote).filter(([, value]) => value !== "" && value != null)),
    // Для PDF локальный анализ видит только имя файла и создаёт ложные предупреждения.
    // Если серверный ИИ ответил, доверяем его списку проверок.
    warnings: remote.warnings ?? local.warnings,
  } as RecognizedLoan;
}
