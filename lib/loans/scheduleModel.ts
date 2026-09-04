// График кредита как расчёт от остатка долга. До этого графика как сущности
// не было: набор платежей с метками в comment, простой процент на всю сумму,
// а нетиповые договоры (капитализация, реинвест процентов, допвзносы, транши)
// зашивались под фамилию. Здесь одна чистая функция от условий договора.

export interface DatedAmount {
  date: string;
  amount: number;
}

export type InterestFrequency = "monthly" | "quarterly" | "at_maturity";
/** flat_period — фиксированная доля ставки за период (3% в месяц = 3%); actual_days — по дням/базису. */
export type RateMode = "flat_period" | "actual_days";
/** paid — проценты выплачиваются; capitalized — не платятся, добавляются к долгу. */
export type InterestPayout = "paid" | "capitalized";

export interface LoanTerms {
  principal: number;
  startDate: string;
  dueDate: string;
  annualRate: number;
  /** Ставка в месяц, если договор сформулирован так; приоритетнее annualRate при monthly. */
  monthlyRate?: number;
  interestFrequency: InterestFrequency;
  /** День месяца для дат начисления; по умолчанию — день startDate. */
  paymentDay?: number;
  rateMode: RateMode;
  dayCountBasis: 365 | 366 | 360;
  interestPayout: InterestPayout;
  /** Выплаченные проценты каждые N периодов добавляются к долгу (заёмщик их реинвестирует). */
  reinvestEveryPeriods?: number;
  /** Дополнительные взносы, увеличивающие долг с указанной даты. */
  extraContributions?: DatedAmount[];
  /** Выдачи траншами; пусто — вся сумма в startDate. */
  tranches?: DatedAmount[];
}

export interface ScheduleRow {
  dueDate: string;
  kind: "principal" | "interest";
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
}

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const DAY_MS = 86_400_000;

function utc(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
const iso = (date: Date) => date.toISOString().slice(0, 10);
function addMonthsClamped(date: Date, months: number, day: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, last)));
}
function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}

/** Даты начисления от startDate до dueDate включительно (последняя — dueDate). */
export function accrualDates(terms: LoanTerms): string[] {
  const start = utc(terms.startDate);
  const due = utc(terms.dueDate);
  if (terms.interestFrequency === "at_maturity" || due <= start) return [iso(due)];
  const step = terms.interestFrequency === "monthly" ? 1 : 3;
  const day = terms.paymentDay ?? start.getUTCDate();
  const dates: string[] = [];
  for (let index = 1; index < 400; index++) {
    const next = addMonthsClamped(start, step * index, day);
    if (next >= due) break;
    dates.push(iso(next));
  }
  dates.push(iso(due));
  return dates;
}

export function buildLoanSchedule(terms: LoanTerms): ScheduleRow[] {
  const contributions = [...(terms.extraContributions ?? [])].filter((item) => item.amount > 0).sort((a, b) => a.date.localeCompare(b.date));
  const tranches = (terms.tranches?.length ? terms.tranches : [{ date: terms.startDate, amount: terms.principal }])
    .filter((item) => item.amount > 0).sort((a, b) => a.date.localeCompare(b.date));
  const dates = accrualDates(terms);
  const periodsPerYear = terms.interestFrequency === "monthly" ? 12 : terms.interestFrequency === "quarterly" ? 4 : 1;
  const flatRate = terms.interestFrequency === "monthly" && terms.monthlyRate
    ? terms.monthlyRate / 100
    : terms.annualRate / 100 / periodsPerYear;

  const rows: ScheduleRow[] = [];
  let capitalized = 0;
  let reinvested = 0;
  let periodStart = utc(terms.startDate);
  let paidSinceReinvest = 0;

  const outstandingOn = (day: string) =>
    tranches.reduce((sum, item) => item.date <= day ? sum + item.amount : sum, 0)
    + contributions.reduce((sum, item) => item.date <= day ? sum + item.amount : sum, 0)
    + capitalized + reinvested;

  dates.forEach((date, index) => {
    const periodEnd = utc(date);
    const balanceBefore = round2(outstandingOn(iso(periodStart)));
    let interest: number;
    if (terms.rateMode === "flat_period") {
      interest = round2(outstandingOn(iso(periodStart)) * flatRate);
    } else {
      // По дням: остаток на каждый день периода × годовая ставка / базис.
      let sum = 0;
      for (let cursor = periodStart; cursor < periodEnd; cursor = new Date(cursor.getTime() + DAY_MS)) sum += outstandingOn(iso(cursor));
      interest = round2(sum * terms.annualRate / 100 / terms.dayCountBasis);
    }
    if (terms.interestPayout === "capitalized") {
      capitalized = round2(capitalized + interest);
    } else if (interest > 0) {
      rows.push({ dueDate: date, kind: "interest", amount: interest, balanceBefore, balanceAfter: balanceBefore });
      paidSinceReinvest = round2(paidSinceReinvest + interest);
      if (terms.reinvestEveryPeriods && (index + 1) % terms.reinvestEveryPeriods === 0) {
        reinvested = round2(reinvested + paidSinceReinvest);
        paidSinceReinvest = 0;
      }
    }
    if (index === dates.length - 1) {
      const principalDue = round2(outstandingOn(date));
      rows.push({ dueDate: date, kind: "principal", amount: principalDue, balanceBefore: principalDue, balanceAfter: 0 });
    }
    periodStart = periodEnd;
  });
  void daysBetween;
  return rows;
}

/** Сумма к возврату в дату погашения (тело с капитализацией и реинвестом). */
export function principalAtMaturity(terms: LoanTerms): number {
  return buildLoanSchedule(terms).find((row) => row.kind === "principal")?.amount ?? 0;
}
