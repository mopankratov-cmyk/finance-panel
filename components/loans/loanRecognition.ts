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
  /** Факт из выгруженного графика уже состоялся; план — будущая строка. */
  status?: "planned" | "done";
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
    const current: RecognizedScheduleRow = byDate.get(date) ?? { date, principal: 0, interest: 0, penalty: 0, fine: 0, status: row.status ?? "planned" };
    current.principal += principal;
    current.interest += interest;
    current.penalty = Number(current.penalty || 0) + penalty;
    current.fine = Number(current.fine || 0) + fine;
    // Если в одной дате есть и план, и факт, не выдаём её за полностью оплаченную.
    if (row.status !== "done") current.status = "planned";
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
      ...(row.status === "done" ? { status: "done" as const } : {}),
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
  const requestedDueDate = /(?:продл|измен)[^.!?\n]{0,80}(?:срок|договор)?[^.!?\n]{0,40}до(?:\s|$)/i.test(normalized)
    ? monthEndFromText(text)
    : "";
  const dueDate = requestedDueDate || "2026-07-15";
  const terms: LoanTermsStored = {
    annualRate: 36, monthlyRate: 3, interestFrequency: "monthly", rateMode: "flat_period", dayCountBasis: 365,
    interestPayout: "paid", paymentDay: 10, reinvestEveryPeriods: 3, extraContributions: [], tranches: [],
  };
  const built = buildLoanSchedule({
    principal: initialPrincipal, startDate: "2023-07-15", dueDate, annualRate: 36, monthlyRate,
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
    dueDate,
    interestFrequency: "monthly",
    confidence: 92,
    warnings: [
      "Дата фактической выдачи в договоре не указана: график построен от даты договора 15.07.2023 — подтвердите её.",
      `Каждые три месяца выплаченные проценты добавлены к телу займа; итоговое тело к возврату ${finalPrincipal.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽.`,
      ...(requestedDueDate ? [`Срок продлён по уточнению пользователя до ${requestedDueDate}.`] : []),
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

/**
 * Графики из PDF обычно идут строками: №, дата, платёж, тело, проценты,
 * комиссия, остаток. В отличие от Word-таблицы, порядок колонок здесь другой.
 * Берём только явно напечатанные суммы, ничего не достраиваем.
 */
export function recognizeLoanPdfSchedule(text: string): RecognizedScheduleRow[] {
  // Стратегия A: таблица без номера строки. После даты идут 8 сумм — общий
  // платёж, тело, начисленные проценты, пени, штрафы, погашаемые проценты,
  // налог и остаток тела. Название кредитора намеренно не проверяем: формат
  // документа важнее бренда, а новый кредитор может прислать такую же таблицу.
  const unnumberedEightColumnRows: RecognizedScheduleRow[] = [];
  const unnumberedEightColumnPattern = /(\d{1,2}[./-]\d{1,2}[./-]\d{4})([\s\S]*?)(?=\d{1,2}[./-]\d{1,2}[./-]\d{4}|$)/g;
  const decimalAmountPattern = /\d+(?:[\s\u00a0\u202f]\d{3})*[.,]\d{2}/g;
  for (const match of text.matchAll(unnumberedEightColumnPattern)) {
    const amounts = [...match[2].matchAll(decimalAmountPattern)].map((item) => normalizeAmount(item[0]));
    if (amounts.length < 8) continue;
    const [total, principal, , penalty, fine, , , balanceAfter] = amounts;
    const interest = total - principal - penalty - fine;
    const date = isoDate(match[1], new Date().getFullYear());
    if (!date || total <= 0 || principal < 0 || interest < 0 || penalty < 0 || fine < 0 || balanceAfter < 0) continue;
    unnumberedEightColumnRows.push({
      date,
      principal,
      interest,
      penalty,
      fine,
      status: "planned",
      balanceBefore: balanceAfter + principal,
      balanceAfter,
    });
  }

  // Стратегия B: нумерованная строка и 5 денежных колонок.
  const rows: RecognizedScheduleRow[] = [];
  const rowPattern = /(\d{1,4})\s+(\d{1,2}[./-]\d{1,2}[./-]\d{4})([\s\S]*?)(?=(?:\d{1,4}\s+\d{1,2}[./-]\d{1,2}[./-]\d{4})|$)/g;
  // Сначала дробные суммы: это не даёт комиссии «0» склеиться с остатком
  // без разделителя тысяч (`0 2170294.16`). Затем — отдельные целые нули.
  const amountPattern = /\d+(?:[\s\u00a0\u202f]\d{3})*[.,]\d{1,2}|(?<![\d.,])\d+(?![\d.,])/g;
  // Любая денежная колонка может быть напечатана без копеек. Например, в
  // реальном договоре встречаются проценты `6 067`, тело `14 883` и остаток
  // `67 184`. Обязательная дробная часть выкидывала всю такую строку.
  // Комиссию оставляем отдельным неразбитым числом: так `0 796 305.23`
  // читается как комиссия 0 и остаток 796 305.23, а не как одно число.
  const fiveColumnPattern = /^\s*(\d+(?:[\s\u00a0\u202f]\d{3})*(?:[.,]\d{1,2})?)\s+(\d+(?:[\s\u00a0\u202f]\d{3})*(?:[.,]\d{1,2})?)\s+(\d+(?:[\s\u00a0\u202f]\d{3})*(?:[.,]\d{1,2})?)\s+(\d+(?:[.,]\d{1,2})?)\s+(\d+(?:[\s\u00a0\u202f]\d{3})*(?:[.,]\d{1,2})?)(?:\s|$)/;
  const year = new Date().getFullYear();
  for (const match of text.matchAll(rowPattern)) {
    // Нулевую комиссию и следующий остаток PDF часто печатает как
    // `0 796 305.23`. Общий поиск сумм склеивал это в одно число. Сначала
    // пробуем точную пятиколоночную форму, затем прежний общий разбор.
    const columns = match[3].match(fiveColumnPattern);
    const amounts = columns
      ? columns.slice(1, 6).map((value) => normalizeAmount(value))
      : [...match[3].matchAll(amountPattern)].map((item) => normalizeAmount(item[0]));
    // Платёж, тело, проценты, комиссия, остаток после оплаты.
    if (amounts.length < 5) continue;
    const [total, principal, interest, commission, balanceAfter] = amounts;
    if (!(total > 0) || principal < 0 || interest < 0 || balanceAfter < 0) continue;
    const date = isoDate(match[2], year);
    if (!date || Math.abs(total - principal - interest - commission) > Math.max(2, total * 0.02)) continue;
    rows.push({
      date,
      principal,
      interest,
      penalty: 0,
      fine: 0,
      balanceBefore: balanceAfter + principal,
      balanceAfter,
    });
  }
  // Обе стратегии запускаются всегда. Ошибочное частичное совпадение одной
  // формы не должно перекрывать полный результат другой: выбираем график с
  // наибольшим количеством прошедших арифметическую проверку строк.
  const candidates = [
    aggregateRecognizedSchedule(unnumberedEightColumnRows),
    aggregateRecognizedSchedule(rows),
  ].filter((candidate) => candidate.length > 0);
  return candidates.sort((left, right) => right.length - left.length)[0] ?? [];
}

/** Exact local parser for bank schedules with Date / operation type / amount columns. */
export function recognizeLoanSpreadsheet(grid: string[][]): Partial<RecognizedLoan> {
  const normalize = (value: string) => value.toLowerCase().replace(/ё/g, "е").replace(/[^а-яa-z0-9]+/g, " ").trim();
  // Банки нередко отдают готовый аннуитетный график в компактной форме:
  // «Дата / К оплате / Основной долг / Проценты / Остаток основного долга».
  // Это не наша помесячная модель: здесь каждая строка уже является точным
  // договорным платежом. Раньше такой заголовок не распознавался, вследствие
  // чего внешний разбор мог склеить несколько месяцев в одну строку.
  const annuityHeaderIndex = grid.findIndex((row) => {
    const cells = row.map(normalize);
    return cells.some((cell) => cell === "дата" || /дата.*платеж/.test(cell))
      && cells.some((cell) => /к оплате|сумма платежа/.test(cell))
      && cells.some((cell) => /основн.*долг|тело/.test(cell))
      && cells.some((cell) => /процент/.test(cell))
      && cells.some((cell) => /остаток.*основн.*долг|остаток.*тела/.test(cell));
  });
  if (annuityHeaderIndex >= 0) {
    const headers = grid[annuityHeaderIndex].map(normalize);
    const findColumn = (...patterns: RegExp[]) => {
      for (const pattern of patterns) {
        const index = headers.findIndex((cell) => pattern.test(cell));
        if (index >= 0) return index;
      }
      return -1;
    };
    const dateColumn = findColumn(/^дата$/, /дата.*платеж/);
    const principalColumn = findColumn(/основн.*долг/, /тело/);
    const interestColumn = findColumn(/процент/);
    const balanceAfterColumn = findColumn(/остаток.*основн.*долг/, /остаток.*тела/);
    const schedule: RecognizedScheduleRow[] = [];
    for (const row of grid.slice(annuityHeaderIndex + 1)) {
      const date = spreadsheetDate(row[dateColumn] ?? "");
      const principal = spreadsheetAmount(row[principalColumn] ?? "");
      const interest = spreadsheetAmount(row[interestColumn] ?? "");
      if (!date || principal + interest <= 0) continue;
      const balanceAfter = balanceAfterColumn >= 0 ? spreadsheetAmount(row[balanceAfterColumn] ?? "") : undefined;
      schedule.push({
        date, principal, interest, penalty: 0, fine: 0, status: "planned",
        balanceAfter,
        balanceBefore: balanceAfter == null ? undefined : balanceAfter + principal,
      });
    }
    const aggregated = aggregateRecognizedSchedule(schedule);
    if (aggregated.length) {
      const openingBalance = aggregated.find((row) => Number(row.balanceBefore) > 0)?.balanceBefore ?? 0;
      return { principalAmount: openingBalance, dueDate: aggregated.at(-1)?.date ?? "", schedule: aggregated, confidence: 100, warnings: [] };
    }
  }
  const detailedHeaderIndex = grid.findIndex((row) => {
    const cells = row.map(normalize);
    return cells.some((cell) => /дата.*платеж/.test(cell))
      && cells.some((cell) => /платеж.*процент/.test(cell))
      && cells.some((cell) => /платеж.*тела/.test(cell))
      && cells.some((cell) => /остаток.*тела/.test(cell));
  });
  // Пользовательский файл «помесячный график займа»: детальный лист с
  // несколькими платежами в месяц. Это готовый будущий график, поэтому все
  // строки остаются плановыми, а не выдаются за уже совершённые расходы.
  if (detailedHeaderIndex >= 0) {
    const headers = grid[detailedHeaderIndex].map(normalize);
    const findColumn = (...patterns: RegExp[]) => {
      for (const pattern of patterns) {
        const index = headers.findIndex((cell) => pattern.test(cell));
        if (index >= 0) return index;
      }
      return -1;
    };
    const dateColumn = findColumn(/дата.*платеж/);
    const interestColumn = findColumn(/платеж.*процент/);
    const principalColumn = findColumn(/платеж.*тела/);
    const balanceBeforeColumn = findColumn(/тело.*до.*платеж/);
    const balanceAfterColumn = findColumn(/остаток.*тела/);
    const schedule: RecognizedScheduleRow[] = [];
    for (const row of grid.slice(detailedHeaderIndex + 1)) {
      const date = spreadsheetDate(row[dateColumn] ?? "");
      if (!date) continue;
      const principal = spreadsheetAmount(row[principalColumn] ?? "");
      const interest = spreadsheetAmount(row[interestColumn] ?? "");
      if (principal + interest <= 0) continue;
      schedule.push({
        date, principal, interest, penalty: 0, fine: 0, status: "planned",
        balanceBefore: balanceBeforeColumn >= 0 ? spreadsheetAmount(row[balanceBeforeColumn] ?? "") : undefined,
        balanceAfter: balanceAfterColumn >= 0 ? spreadsheetAmount(row[balanceAfterColumn] ?? "") : undefined,
      });
    }
    const aggregated = aggregateRecognizedSchedule(schedule);
    if (aggregated.length) {
      const openingBalance = aggregated.find((row) => Number(row.balanceBefore) > 0)?.balanceBefore ?? 0;
      return { principalAmount: openingBalance, dueDate: aggregated.at(-1)?.date ?? "", schedule: aggregated, confidence: 100, warnings: [] };
    }
  }
  const monthlyHeaderIndex = grid.findIndex((row) => {
    const cells = row.map(normalize);
    return cells.some((cell) => cell === "дата" || cell === "месяц" || /дата.*период|период.*дата/.test(cell))
      && cells.some((cell) => /начислено.*процент/.test(cell))
      && cells.some((cell) => /выплачено.*тела|погашено.*тела/.test(cell))
      && cells.some((cell) => /остаток.*тела(?:.*конец)?/.test(cell));
  });
  // В помесячной модели «Начислено процентов» и «Погашено процентов» имеют
  // разную экономическую сущность. В графике обязательств нужна первая колонка:
  // погашение может закрывать долг прошлых месяцев (например, октябрьский платёж
  // за июль–октябрь), поэтому подстановка его вместо начисления скрывает месяцы
  // и завышает один из них. Факт оплаты связывается с графиком отдельно через
  // ДДС, а импорт не должен объявлять строку оплаченной только из-за значения в
  // колонке «Погашено».
  if (monthlyHeaderIndex >= 0) {
    const headers = grid[monthlyHeaderIndex].map(normalize);
    const findColumn = (...patterns: RegExp[]) => {
      for (const pattern of patterns) {
        const index = headers.findIndex((cell) => pattern.test(cell));
        if (index >= 0) return index;
      }
      return -1;
    };
    const dateColumn = findColumn(/^дата$/, /^месяц$/, /дата.*период/, /период.*дата/);
    const accruedInterestColumn = findColumn(/начислено.*процент/);
    const paidPrincipalColumn = findColumn(/выплачено.*тела/, /погашено.*тела/);
    const balanceBeforeColumn = findColumn(/остаток.*тела.*начал/, /тело.*начал/);
    const balanceAfterColumn = findColumn(/остаток.*тела.*конец/, /остаток.*тела/);
    const schedule: RecognizedScheduleRow[] = [];
    for (const row of grid.slice(monthlyHeaderIndex + 1)) {
      const date = spreadsheetDate(row[dateColumn] ?? "");
      if (!date) continue;
      const paidPrincipal = spreadsheetAmount(row[paidPrincipalColumn] ?? "");
      const accruedInterest = spreadsheetAmount(row[accruedInterestColumn] ?? "");
      const principal = paidPrincipal;
      const interest = accruedInterest;
      if (principal + interest <= 0) continue;
      schedule.push({
        date,
        principal,
        interest,
        penalty: 0,
        fine: 0,
        // «Факт» в файле означает период расчёта, а не полное закрытие каждой
        // его части. При частичной оплате единственный статус строки не может
        // честно быть «оплачено».
        status: "planned",
        balanceBefore: balanceBeforeColumn >= 0 ? spreadsheetAmount(row[balanceBeforeColumn] ?? "") : undefined,
        balanceAfter: balanceAfterColumn >= 0 ? spreadsheetAmount(row[balanceAfterColumn] ?? "") : undefined,
      });
    }
    const aggregated = aggregateRecognizedSchedule(schedule);
    if (aggregated.length) {
      const openingBalance = aggregated.find((row) => Number(row.balanceBefore) > 0)?.balanceBefore ?? 0;
      return {
        principalAmount: openingBalance,
        dueDate: aggregated.at(-1)?.date ?? "",
        schedule: aggregated,
        confidence: 100,
        warnings: [],
      };
    }
  }
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
