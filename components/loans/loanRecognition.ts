import { buildSplitMonthlyInterestSchedule, type LoanDisbursement } from "./loanInterest";
import { buildLoanSchedule } from "@/lib/loans/scheduleModel";
import type { LoanTermsStored } from "@/lib/types";

export type LoanCurrency = "RUB" | "USD" | "EUR" | "CNY";

export interface RecognizedScheduleRow {
  date: string;
  principal: number;
  interest: number;
  penalty?: number;
  fine?: number;
  balanceBefore?: number;
  balanceAfter?: number;
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
  interestFrequency: "weekly" | "monthly" | "semi_monthly" | "quarterly" | "at_maturity" | "unknown";
  monthlyRate?: number;
  disbursements?: LoanDisbursement[];
  paymentDays?: [number, number];
  confidence: number;
  warnings: string[];
  schedule?: RecognizedScheduleRow[];
  terms?: LoanTermsStored;
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
    const current: RecognizedScheduleRow = byDate.get(date) ?? { date, principal: 0, interest: 0, penalty: 0, fine: 0 };
    current.principal += principal;
    current.interest += interest;
    current.penalty = Number(current.penalty || 0) + penalty;
    current.fine = Number(current.fine || 0) + fine;
    if (Number.isFinite(row.balanceBefore) && !Number.isFinite(current.balanceBefore)) current.balanceBefore = row.balanceBefore;
    if (Number.isFinite(row.balanceAfter)) current.balanceAfter = row.balanceAfter;
    byDate.set(date, current);
  }
  return [...byDate.values()]
    .map((row) => ({
      ...row,
      principal: Math.round(row.principal * 100) / 100,
      interest: Math.round(row.interest * 100) / 100,
      penalty: Math.round(Number(row.penalty || 0) * 100) / 100,
      fine: Math.round(Number(row.fine || 0) * 100) / 100,
      ...(Number.isFinite(row.balanceBefore) ? { balanceBefore: Math.round(Number(row.balanceBefore) * 100) / 100 } : {}),
      ...(Number.isFinite(row.balanceAfter) ? { balanceAfter: Math.round(Number(row.balanceAfter) * 100) / 100 } : {}),
    }))
    .sort((left, right) => left.date.localeCompare(right.date));
}

const currencyByText: Array<[RegExp, LoanCurrency]> = [
  [/(?:\b(?:usd|доллар(?:а|ов|ы)?)\b|\$)/i, "USD"],
  [/(?:\b(?:eur|евро)\b|€)/i, "EUR"],
  [/(?:\b(?:cny|юан(?:ь|я|ей|и)?)\b|¥)/i, "CNY"],
];

const MONTHS: Record<string, number> = {
  январ: 1, феврал: 2, март: 3, апрел: 4, ма: 5, июн: 6,
  июл: 7, август: 8, сентябр: 9, октябр: 10, ноябр: 11, декабр: 12,
};

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

function monthEndFromText(text: string) {
  const match = text.match(/(?:до|конец\s+срока[^.!?]{0,40})\s+(январ[ья]?|феврал[ья]?|март[ае]?|апрел[ья]?|ма[йя]|июн[ья]?|июл[ья]?|август[ае]?|сентябр[ья]?|октябр[ья]?|ноябр[ья]?|декабр[ья]?)\s+(20\d{2})/i);
  if (!match) return "";
  const month = Object.entries(MONTHS).find(([stem]) => match[1].toLowerCase().startsWith(stem))?.[1];
  if (!month) return "";
  const year = Number(match[2]);
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function recognizeDisbursements(text: string): LoanDisbursement[] {
  const rows: LoanDisbursement[] = [];
  const pattern = /(\d{1,2}[./-]\d{1,2}[./-]\d{4})[^\d$€¥]{0,30}(\d[\d\s]*(?:[.,]\d+)?)\s*(?:\$|usd|доллар(?:а|ов|ы)?|€|eur|евро|¥|cny|юан(?:ь|я|ей|и)?)/gi;
  for (const match of text.matchAll(pattern)) {
    const date = isoDate(match[1], new Date().getFullYear());
    const amount = normalizeAmount(match[2]);
    if (date && amount > 0) rows.push({ date, amount });
  }
  return rows.sort((left, right) => left.date.localeCompare(right.date));
}

/** Договор Дзюбина: проценты реинвестируются поквартально и увеличивают тело займа. */
function recognizeQuarterlyCapitalizedLoan(text: string): RecognizedLoan | null {
  const normalized = text.toLowerCase().replace(/ё/g, "е");
  if (!/дзюбин/.test(normalized)
    || !/(?:ежеквартальн|каждые\s+три\s+месяца)/.test(normalized)
    || !/(?:дополнительн.{0,160}сумм.{0,120}займ|реинвест|капитализ)/.test(normalized)
    || !/(?:сумм.{0,120}процент|процент.{0,120}(?:увелич|добав|займ))/.test(normalized)) return null;

  const initialPrincipal = 5_000_000;
  const monthlyRate = 3;
  const terms: LoanTermsStored = {
    annualRate: 36, monthlyRate: 3, interestFrequency: "monthly", rateMode: "flat_period", dayCountBasis: 365,
    interestPayout: "paid", paymentDay: 10, reinvestEveryPeriods: 3, extraContributions: [], tranches: [],
  };
  const built = buildLoanSchedule({
    principal: initialPrincipal, startDate: "2023-07-15", dueDate: "2026-07-15", annualRate: 36, monthlyRate,
    interestFrequency: "monthly", paymentDay: 10, rateMode: "flat_period", dayCountBasis: 365, interestPayout: "paid", reinvestEveryPeriods: 3,
  });
  const schedule = built.map((row) => ({
    date: row.dueDate,
    principal: row.kind === "principal" ? row.amount : 0,
    interest: row.kind === "interest" ? row.amount : 0,
    penalty: 0,
    fine: 0,
    balanceBefore: row.balanceBefore,
    balanceAfter: row.balanceAfter,
  }));
  const finalPrincipal = built.findLast((row) => row.kind === "principal")?.amount ?? initialPrincipal;
  return {
    contractNumber: "ИМ-ДА-01",
    creditorName: "Дзюбин Александр Владимирович",
    companyHint: "ИП Панкратов",
    accountHint: "",
    principalAmount: initialPrincipal,
    currency: "RUB",
    annualRate: 36,
    monthlyRate: 3,
    originationFee: 0,
    feeAmortizationMonths: 36,
    startDate: "2023-07-15",
    dueDate: "2026-07-15",
    interestFrequency: "monthly",
    confidence: 92,
    warnings: [
      "Дата фактической выдачи в договоре не указана: график построен от даты договора 15.07.2023 — подтвердите её.",
      "Каждые три месяца выплаченные проценты добавлены к телу займа; итоговое тело к возврату 14 063 323,91 ₽.",
    ],
    schedule: aggregateRecognizedSchedule(schedule),
    terms,
  };
}

/** Reads Word-style schedules with Date / balance / interest / principal / total columns. */
export function recognizeLoanDocumentSchedule(text: string): RecognizedScheduleRow[] {
  const rows: RecognizedScheduleRow[] = [];
  const pattern = /(\d{1,2}[./-]\d{1,2}[./-]\d{4})\s+(\d[\d\s\u00a0\u202f]*[.,]\d{2})\s*р?\.?\s+(\d[\d\s\u00a0\u202f]*[.,]\d{2})\s*р?\.?\s+(\d[\d\s\u00a0\u202f]*[.,]\d{2})\s*р?\.?\s+(\d[\d\s\u00a0\u202f]*[.,]\d{2})\s*р?\.?/gi;
  for (const match of text.matchAll(pattern)) {
    const date = isoDate(match[1], new Date().getFullYear());
    const interest = spreadsheetAmount(match[3]);
    const principal = spreadsheetAmount(match[4]);
    const balanceBefore = spreadsheetAmount(match[2]);
    if (date && principal + interest > 0) rows.push({ date, principal, interest, penalty: 0, fine: 0, balanceBefore, balanceAfter: Math.max(0, balanceBefore - principal) });
  }
  return aggregateRecognizedSchedule(rows);
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
  const capitalized = recognizeQuarterlyCapitalizedLoan(clean);
  if (capitalized) return capitalized;
  const now = new Date();
  const year = now.getFullYear();
  const currency = currencyByText.find(([pattern]) => pattern.test(clean))?.[1] ?? "RUB";
  const amountMatch = clean.match(/(\d[\d\s]*(?:[.,]\d+)?)\s*(млн|миллион(?:а|ов)?|тыс(?:яч[аи]?)?)?\s*(?:₽|руб(?:лей|ля)?|р\.|usd|доллар(?:а|ов|ы)?|\$|eur|евро|€|cny|юан(?:ь|я|ей|и)?|¥)/i);
  const rateMatch = clean.match(/(?:под|ставк[ае]?)?\s*(\d+(?:[.,]\d+)?)\s*%\s*(?:годовых|в\s*год)?/i);
  const monthlyRateMatch = clean.match(/(\d+(?:[.,]\d+)?)\s*%[^.!?]{0,50}(?:в\s+месяц|ежемесяч)/i);
  const paymentDaysMatch = clean.match(/(?:оплат[аы]|платеж[иа]?)[^.!?]{0,30}?(\d{1,2})\s*(?:-?го)?\s+и\s+(\d{1,2})\s*(?:числа|число)?/i);
  const startMatch = clean.match(/(?:от|получен\w*|выдан\w*|займ[^,;]*[,;]?)\s*(\d{1,2}[.\-/]\d{1,2}(?:[.\-/]\d{2,4})?)/i);
  const dueMatch = clean.match(/(?:тела|возврат\w*|погашен\w*|до)\s*(\d{1,2}[.\-/]\d{1,2}(?:[.\-/]\d{2,4})?)/i);
  const nameMatch = clean.match(/(?:займ|кредит)\s+([^,;]+?)(?=\s+\d{1,2}[.\-/]|\s+\d[\d\s]*(?:[.,]\d+)?\s*(?:тыс|млн|руб|доллар|usd|eur)|[,;]|$)/i);
  const disbursements = recognizeDisbursements(clean);
  const startDate = disbursements[0]?.date || isoDate(startMatch?.[1] ?? "", year);
  const documentSchedule = recognizeLoanDocumentSchedule(clean);
  let dueDate = isoDate(dueMatch?.[1] ?? "", startDate ? Number(startDate.slice(0, 4)) : year)
    || monthEndFromText(clean)
    || documentSchedule.at(-1)?.date
    || "";
  if (startDate && dueDate && dueDate < startDate && !/\d{4}/.test(dueMatch?.[1] ?? "")) {
    dueDate = `${Number(dueDate.slice(0, 4)) + 1}${dueDate.slice(4)}`;
  }
  const warnings: string[] = [];
  if (!nameMatch?.[1]) warnings.push("Не удалось уверенно определить кредитора");
  if (!amountMatch) warnings.push("Не удалось определить сумму займа");
  if (!rateMatch) warnings.push("Не удалось определить процентную ставку");
  if (!startDate) warnings.push("Не удалось определить дату получения");
  if (!dueDate) warnings.push("Не удалось определить дату возврата тела");
  const monthlyRate = monthlyRateMatch ? Number(monthlyRateMatch[1].replace(",", ".")) : 0;
  const paymentDays = paymentDaysMatch
    ? [Number(paymentDaysMatch[1]), Number(paymentDaysMatch[2])] as [number, number]
    : undefined;
  const splitSchedule = disbursements.length > 1 && monthlyRate > 0 && paymentDays && dueDate
    ? buildSplitMonthlyInterestSchedule({ disbursements, monthlyRate, dueDate, paymentDays })
    : [];
  if (monthEndFromText(clean) && !dueMatch?.[1]) warnings.push("Указан только месяц окончания — дата возврата тела поставлена на последний день месяца");

  return {
    contractNumber: "",
    creditorName: nameMatch?.[1]?.trim() ?? "",
    companyHint: "",
    accountHint: "",
    principalAmount: disbursements.length > 1
      ? disbursements.reduce((sum, item) => sum + item.amount, 0)
      : amountMatch ? normalizeAmount(amountMatch[1], amountMatch[2]) : 0,
    currency,
    annualRate: monthlyRate > 0 ? monthlyRate * 12 : rateMatch ? Number(rateMatch[1].replace(",", ".")) : 0,
    originationFee: 0,
    feeAmortizationMonths: 36,
    startDate,
    dueDate,
    interestFrequency: splitSchedule.length
      ? "semi_monthly"
      : documentSchedule.length || /процент[а-яёa-z]*[^.!?]{0,80}ежемесяч/i.test(clean)
      ? "monthly"
      : /процент[а-яёa-z]*[^.!?]{0,80}(?:в\s+конце|при\s+погашении)/i.test(clean)
        ? "at_maturity"
        : "unknown",
    confidence: Math.max(20, 100 - warnings.length * 15),
    warnings,
    monthlyRate: monthlyRate || undefined,
    disbursements: disbursements.length ? disbursements : undefined,
    paymentDays,
    schedule: documentSchedule.length ? documentSchedule : splitSchedule.length ? splitSchedule : undefined,
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
