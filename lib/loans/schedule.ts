// Построение и нормализация графика кредита — чистые функции без React.
// Перенесены из LoanForm.tsx, чтобы сервер строил график сам: раньше это
// происходило в браузере после распознавания, и у разных сотрудников мог
// получиться разный график по одному документу.

import { buildSplitMonthlyInterestSchedule, fixedMonthlyInterest } from "@/components/loans/loanInterest";
import { aggregateRecognizedSchedule, type RecognizedLoan, type RecognizedScheduleRow } from "@/components/loans/loanRecognition";
import { roundLoanMoney } from "@/lib/opiu/loanCurrency";
import type { PaymentStatus } from "@/lib/types";

export interface LoanScheduleDraft {
  id: string;
  date: string;
  principal: number;
  interest: number;
  penalty: number;
  fine: number;
  principalOriginal?: number;
  interestOriginal?: number;
  penaltyOriginal?: number;
  fineOriginal?: number;
  status: PaymentStatus;
}

export const emptyScheduleRow = (): LoanScheduleDraft => ({ id: crypto.randomUUID(), date: "", principal: 0, interest: 0, penalty: 0, fine: 0, principalOriginal: 0, interestOriginal: 0, penaltyOriginal: 0, fineOriginal: 0, status: "planned" });
export const scheduleRow = (row: Omit<LoanScheduleDraft, "id">): LoanScheduleDraft => ({ id: crypto.randomUUID(), ...row });

export function normalizeScheduleMoney(row: LoanScheduleDraft): LoanScheduleDraft {
  return {
    ...row,
    principal: roundLoanMoney(row.principal),
    interest: roundLoanMoney(row.interest),
    penalty: roundLoanMoney(row.penalty),
    fine: roundLoanMoney(row.fine),
    principalOriginal: roundLoanMoney(Number(row.principalOriginal ?? row.principal)),
    interestOriginal: roundLoanMoney(Number(row.interestOriginal ?? row.interest)),
    penaltyOriginal: roundLoanMoney(Number(row.penaltyOriginal ?? row.penalty)),
    fineOriginal: roundLoanMoney(Number(row.fineOriginal ?? row.fine)),
  };
}

/** Расчётный график, когда в документе своего нет: простые проценты, тело — в дату возврата. */
export function monthlySchedule(data: RecognizedLoan, rate: number): LoanScheduleDraft[] {
  if (!data.startDate || !data.dueDate || data.principalAmount <= 0) return [emptyScheduleRow()];
  const principalRub = data.principalAmount * rate;
  if (data.interestFrequency === "semi_monthly" && data.disbursements?.length && data.monthlyRate && data.paymentDays) {
    return buildSplitMonthlyInterestSchedule({
      disbursements: data.disbursements,
      monthlyRate: data.monthlyRate,
      dueDate: data.dueDate,
      paymentDays: data.paymentDays,
    }).map((row) => scheduleRow({
      ...row,
      principal: roundLoanMoney(row.principal * rate),
      interest: roundLoanMoney(row.interest * rate),
      penalty: roundLoanMoney(row.penalty * rate),
      fine: roundLoanMoney(row.fine * rate),
      principalOriginal: roundLoanMoney(row.principal),
      interestOriginal: roundLoanMoney(row.interest),
      penaltyOriginal: roundLoanMoney(row.penalty),
      fineOriginal: roundLoanMoney(row.fine),
      status: "planned",
    }));
  }
  const start = new Date(`${data.startDate}T12:00:00`);
  const due = new Date(`${data.dueDate}T12:00:00`);
  if (data.interestFrequency !== "monthly") {
    const days = Math.max(1, Math.round((due.getTime() - start.getTime()) / 86_400_000));
    const interestOriginal = data.principalAmount * data.annualRate / 100 * days / 365;
    return [scheduleRow({ date: data.dueDate, principal: roundLoanMoney(principalRub), interest: roundLoanMoney(interestOriginal * rate), penalty: 0, fine: 0, principalOriginal: roundLoanMoney(data.principalAmount), interestOriginal: roundLoanMoney(interestOriginal), penaltyOriginal: 0, fineOriginal: 0, status: "planned" })];
  }
  const rows: LoanScheduleDraft[] = [];
  let cursor = new Date(start);
  while (cursor < due && rows.length < 240) {
    const next = new Date(cursor);
    next.setMonth(next.getMonth() + 1);
    if (next > due) next.setTime(due.getTime());
    const interestOriginal = fixedMonthlyInterest(data.principalAmount, data.annualRate);
    rows.push(scheduleRow({
      date: next.toISOString().slice(0, 10),
      principal: roundLoanMoney(next.getTime() === due.getTime() ? principalRub : 0),
      interest: roundLoanMoney(interestOriginal * rate),
      penalty: 0,
      fine: 0,
      principalOriginal: roundLoanMoney(next.getTime() === due.getTime() ? data.principalAmount : 0),
      interestOriginal: roundLoanMoney(interestOriginal),
      penaltyOriginal: 0,
      fineOriginal: 0,
      status: "planned",
    }));
    cursor = next;
  }
  return rows.length ? rows : [emptyScheduleRow()];
}

/** Распознанные строки документа → строки черновика в рублях по курсу. */
export function recognizedSchedule(rows: RecognizedScheduleRow[] | undefined, rate: number): LoanScheduleDraft[] {
  return aggregateRecognizedSchedule(rows).map((row) => scheduleRow({
    date: row.date,
    principal: roundLoanMoney(Number(row.principal || 0) * rate),
    interest: roundLoanMoney(Number(row.interest || 0) * rate),
    penalty: roundLoanMoney(Number(row.penalty || 0) * rate),
    fine: roundLoanMoney(Number(row.fine || 0) * rate),
    principalOriginal: roundLoanMoney(Number(row.principal || 0)),
    interestOriginal: roundLoanMoney(Number(row.interest || 0)),
    penaltyOriginal: roundLoanMoney(Number(row.penalty || 0)),
    fineOriginal: roundLoanMoney(Number(row.fine || 0)),
    status: "planned",
  }));
}
