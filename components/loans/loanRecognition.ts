export type LoanCurrency = "RUB" | "USD" | "EUR" | "CNY";

export interface RecognizedScheduleRow {
  date: string;
  principal: number;
  interest: number;
  penalty?: number;
  fine?: number;
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

/** Банковские графики часто хранят тело, проценты и неустойку отдельными строками одной даты. */
export function aggregateRecognizedSchedule(rows: RecognizedScheduleRow[] | undefined): RecognizedScheduleRow[] {
  const byDate = new Map<string, RecognizedScheduleRow>();
  for (const row of rows ?? []) {
    const date = String(row.date ?? "").trim();
    const principal = Number(row.principal || 0);
    const interest = Number(row.interest || 0);
    const penalty = Number(row.penalty || 0);
    const fine = Number(row.fine || 0);
    if (!date || ![principal, interest, penalty, fine].every(Number.isFinite)) continue;
    if (principal + interest + penalty + fine <= 0) continue;
    const current = byDate.get(date) ?? { date, principal: 0, interest: 0, penalty: 0, fine: 0 };
    current.principal += principal;
    current.interest += interest;
    current.penalty = Number(current.penalty || 0) + penalty;
    current.fine = Number(current.fine || 0) + fine;
    byDate.set(date, current);
  }
  return [...byDate.values()]
    .map((row) => ({
      ...row,
      principal: Math.round(row.principal * 100) / 100,
      interest: Math.round(row.interest * 100) / 100,
      penalty: Math.round(Number(row.penalty || 0) * 100) / 100,
      fine: Math.round(Number(row.fine || 0) * 100) / 100,
    }))
    .sort((left, right) => left.date.localeCompare(right.date));
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

function spreadsheetDate(raw: string) {
  const clean = String(raw ?? "").trim();
  const serial = Number(clean.replace(",", "."));
  if (Number.isFinite(serial) && serial > 20_000 && serial < 100_000) {
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000).toISOString().slice(0, 10);
  }
  return isoDate(clean, new Date().getFullYear());
}

function spreadsheetAmount(raw: string) {
  const normalized = String(raw ?? "").replace(/[\s\u00a0\u202f]/g, "").replace(",", ".");
  const amount = Number(normalized);
  return Number.isFinite(amount) ? Math.abs(amount) : 0;
}

/** Exact local parser for bank schedules with Date / operation type / amount columns. */
export function recognizeLoanSpreadsheet(grid: string[][]): Partial<RecognizedLoan> {
  const normalize = (value: string) => value.toLowerCase().replace(/ё/g, "е").replace(/[^а-яa-z0-9]+/g, " ").trim();
  const headerIndex = grid.findIndex((row) => {
    const cells = row.map(normalize);
    return cells.some((cell) => /дата платежа/.test(cell))
      && cells.some((cell) => /тип плановой операции|операция/.test(cell))
      && cells.some((cell) => /плановая сумма|сумма/.test(cell));
  });
  if (headerIndex < 0) return {};
  const headers = grid[headerIndex].map(normalize);
  const dateColumn = headers.findIndex((cell) => /дата платежа/.test(cell));
  const typeColumn = headers.findIndex((cell) => /тип плановой операции|операция/.test(cell));
  const amountColumn = headers.findIndex((cell) => /плановая сумма|сумма/.test(cell));
  const schedule: RecognizedScheduleRow[] = [];
  for (const row of grid.slice(headerIndex + 1)) {
    const date = spreadsheetDate(row[dateColumn] ?? "");
    const operation = normalize(row[typeColumn] ?? "");
    const amount = spreadsheetAmount(row[amountColumn] ?? "");
    if (!date || !operation || amount <= 0) continue;
    if (/ссудн.*задолж|основн.*долг|тело/.test(operation)) {
      schedule.push({ date, principal: amount, interest: 0, penalty: 0 });
    } else if (/неустойк|штраф|пен/.test(operation)) {
      schedule.push({ date, principal: 0, interest: 0, penalty: amount });
    } else if (/процент/.test(operation)) {
      schedule.push({ date, principal: 0, interest: amount, penalty: 0 });
    }
  }
  const aggregated = aggregateRecognizedSchedule(schedule);
  if (!aggregated.length) return {};
  const title = grid.slice(0, headerIndex).flat().filter(Boolean).join(" ");
  const startDate = spreadsheetDate(title.match(/дата займа\s*(\d{1,2}[./-]\d{1,2}[./-]\d{4})/i)?.[1] ?? "");
  const creditorName = /сбербанк/i.test(title) ? "Сбербанк" : "";
  const companyHint = title.split(/дата займа/i)[0]
    .match(/(?:ООО|ИП)\s+(?:["«][^"»]+["»]|[А-ЯЁA-Z][А-ЯЁA-Z0-9.-]*(?:\s+[А-ЯЁA-Z][А-ЯЁA-Z0-9.-]*){0,2})/)?.[0]?.trim() ?? "";
  return {
    creditorName,
    companyHint,
    principalAmount: aggregated.reduce((sum, row) => sum + row.principal, 0),
    startDate,
    dueDate: aggregated.at(-1)?.date ?? "",
    schedule: aggregated,
    confidence: 95,
    warnings: [],
  };
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
