/** Фиксированный платёж процентов за полный месяц по годовой ставке. */
export function fixedMonthlyInterest(principalRub: number, annualRate: number) {
  const value = Number(principalRub) * Number(annualRate) / 100 / 12;
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : 0;
}

export interface LoanDisbursement {
  date: string;
  amount: number;
}

export interface SplitMonthlyScheduleRow {
  date: string;
  principal: number;
  interest: number;
  penalty: number;
  fine: number;
}

const DAY_MS = 86_400_000;
const iso = (date: Date) => date.toISOString().slice(0, 10);
const utcDate = (value: string) => new Date(`${value}T00:00:00Z`);
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS);
const monthEnd = (year: number, month: number) => new Date(Date.UTC(year, month + 1, 0));

function datesBetween(from: Date, to: Date) {
  const dates: Date[] = [];
  for (let cursor = from; cursor <= to; cursor = addDays(cursor, 1)) dates.push(cursor);
  return dates;
}

/**
 * Делит единую месячную ставку между двумя расчётными периодами по дням.
 * Платёж 16-го покрывает период после предыдущего платежа по 15-е,
 * платёж 30-го (или в последний день короткого месяца) — с 16-го по день до оплаты.
 */
export function buildSplitMonthlyInterestSchedule({
  disbursements,
  monthlyRate,
  dueDate,
  paymentDays = [16, 30],
}: {
  disbursements: LoanDisbursement[];
  monthlyRate: number;
  dueDate: string;
  paymentDays?: [number, number];
}): SplitMonthlyScheduleRow[] {
  const tranches = disbursements
    .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.date) && Number(item.amount) > 0)
    .sort((left, right) => left.date.localeCompare(right.date));
  if (!tranches.length || monthlyRate <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return [];

  const due = utcDate(dueDate);
  const first = utcDate(tranches[0].date);
  const rows: SplitMonthlyScheduleRow[] = [];
  for (let cursor = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1)); cursor <= due; cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1))) {
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth();
    const last = monthEnd(year, month);
    const firstPayment = new Date(Date.UTC(year, month, Math.min(paymentDays[0], last.getUTCDate())));
    const secondPayment = new Date(Date.UTC(year, month, Math.min(paymentDays[1], last.getUTCDate())));
    const previousLast = new Date(Date.UTC(year, month, 0));
    const firstStart = previousLast.getUTCDate() === 31 ? previousLast : cursor;
    const firstEnd = addDays(firstPayment, -1);
    const secondStart = firstPayment;
    const secondEnd = addDays(secondPayment, -1);
    const periods = [
      { start: firstStart, end: firstEnd, payment: firstPayment },
      { start: secondStart, end: secondEnd, payment: secondPayment },
    ];
    const cycleDays = periods.reduce((sum, period) => sum + datesBetween(period.start, period.end).length, 0);

    for (const period of periods) {
      if (period.payment < first || period.payment > due) continue;
      const principalDays = datesBetween(period.start, period.end).reduce((sum, day) => {
        if (day < first || day > due) return sum;
        const dayIso = iso(day);
        const outstanding = tranches.reduce((value, item) => item.date <= dayIso ? value + item.amount : value, 0);
        return sum + outstanding;
      }, 0);
      const interest = Math.round(principalDays * monthlyRate / 100 / cycleDays * 10) / 10;
      if (interest > 0) rows.push({ date: iso(period.payment), principal: 0, interest, penalty: 0, fine: 0 });
    }
  }

  const totalPrincipal = tranches.reduce((sum, item) => sum + item.amount, 0);
  const maturity = rows.find((row) => row.date === dueDate);
  if (maturity) maturity.principal += totalPrincipal;
  else rows.push({ date: dueDate, principal: totalPrincipal, interest: 0, penalty: 0, fine: 0 });
  return rows.sort((left, right) => left.date.localeCompare(right.date));
}
