import { LOAN_CATEGORIES } from "@/lib/finance/categories";
import type { ScheduleRowKind, ScheduleRowRecord } from "@/lib/loans/scheduleRows";
import type { Loan, Payment } from "@/lib/types";

export interface CashLoanScheduleOption {
  key: string;
  loanId: string;
  loanName: string;
  companyId: string | null;
  dueDate: string;
  amount: number;
  rowIds: string[];
  legacyPaymentIds: string[];
  label: string;
}

export interface CashLoanContractOption {
  loanId: string;
  loanName: string;
  companyId: string | null;
}

const GENERIC_LOAN_PAYMENT_CATEGORIES = new Set([
  "Оплаты по кредитам и займам",
  "Оплата % по кредиту",
]);

function kindsForCategory(category: string): ScheduleRowKind[] | null {
  if (category === LOAN_CATEGORIES.principal) return ["principal"];
  if (category === LOAN_CATEGORIES.interest || category === "Оплата % по кредиту") return ["interest"];
  if (category === LOAN_CATEGORIES.penalty) return ["penalty", "fee"];
  if (category === LOAN_CATEGORIES.fine) return ["fine"];
  if (category === "Оплаты по кредитам и займам") return ["principal", "interest", "penalty", "fine", "fee"];
  return null;
}

export function isLoanRepaymentCategory(category: string) {
  return kindsForCategory(category) !== null || GENERIC_LOAN_PAYMENT_CATEGORIES.has(category);
}

function loanCompanyId(loanId: string, payments: readonly Payment[], paymentCompanies: ReadonlyMap<string, string | null>) {
  const marker = `[loan:${loanId}:`;
  for (const payment of payments) {
    if (!payment.comment?.includes(marker)) continue;
    const companyId = paymentCompanies.get(payment.id) ?? payment.companyId ?? null;
    if (companyId) return companyId;
  }
  return null;
}

function kindLabel(kinds: readonly ScheduleRowKind[]) {
  if (kinds.length > 1) return "весь платёж";
  return kinds[0] === "principal" ? "тело" : kinds[0] === "interest" ? "проценты" : kinds[0] === "fine" ? "штраф" : "пени / комиссия";
}

function loanOptionLabel(loan: Loan) {
  const [year, month, day] = loan.startDate.split("-");
  const date = year && month && day ? `${day}.${month}.${year}` : loan.startDate;
  return `${loan.creditorName} · с ${date} · ${loan.principalAmount.toLocaleString("ru-RU")} ₽`;
}

const normalizeLoanName = (value: string) => value
  .toLowerCase()
  .replace(/ё/g, "е")
  .replace(/[«»"'()]/g, " ")
  .replace(/\b(?:ооо|оао|пао|ао|ип|мкк)\b/g, " ")
  .replace(/[^a-zа-я0-9№-]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

function optionCreditor(option: Pick<CashLoanScheduleOption, "loanName">) {
  return option.loanName.split(" · с ", 1)[0] ?? option.loanName;
}

/**
 * Сужает длинный список графиков по контрагенту банка. Точное имя кредитора
 * сильнее общего бренда: «Сбербанк» не должно смешиваться с договорами
 * «Сбербанк № ...». Если доказательства нет, оставляем полный список.
 */
export function relevantCashLoanScheduleOptions<T extends Pick<CashLoanScheduleOption, "loanId" | "loanName">>(
  options: readonly T[],
  counterparty: string,
  purpose: string,
) {
  const normalizedCounterparty = normalizeLoanName(counterparty);
  const exactLoanIds = new Set(options
    .filter((option) => normalizeLoanName(optionCreditor(option)) === normalizedCounterparty)
    .map((option) => option.loanId));
  if (exactLoanIds.size === 1) return options.filter((option) => exactLoanIds.has(option.loanId));

  const haystack = normalizeLoanName(`${counterparty} ${purpose}`);
  const familyAliases = [
    ["jetlend", "джетленд"],
    ["сбербанк"],
    ["вб финанс"],
    ["точка"],
  ];
  const family = familyAliases.find((aliases) => aliases.some((alias) => haystack.includes(alias)));
  if (!family) return [...options];
  const matching = options.filter((option) => {
    const creditor = normalizeLoanName(optionCreditor(option));
    return family.some((alias) => creditor.includes(alias));
  });
  return matching.length ? matching : [...options];
}

export function cashLoanContractOptions(input: {
  loans: readonly Loan[];
  payments: readonly Payment[];
  paymentCompanies: ReadonlyMap<string, string | null>;
}): CashLoanContractOption[] {
  return input.loans
    .filter((loan) => loan.status === "active")
    .map((loan) => ({
      loanId: loan.id,
      loanName: loanOptionLabel(loan),
      companyId: loanCompanyId(loan.id, input.payments, input.paymentCompanies),
    }))
    .sort((left, right) => left.loanName.localeCompare(right.loanName, "ru"));
}

/** Автоподстановка допустима только когда реквизиты оставили один договор. */
export function suggestedCashLoanScheduleOption(
  options: readonly CashLoanScheduleOption[],
  date: string,
  amount: number,
  counterparty: string,
  purpose: string,
) {
  const relevant = relevantCashLoanScheduleOptions(options, counterparty, purpose);
  if (new Set(relevant.map((option) => option.loanId)).size !== 1) return undefined;
  return closestCashLoanScheduleOption(relevant, date, amount);
}

export function cashLoanScheduleOptions(input: {
  loans: readonly Loan[];
  payments: readonly Payment[];
  paymentCompanies: ReadonlyMap<string, string | null>;
  scheduleRows: readonly ScheduleRowRecord[];
  category: string;
}): CashLoanScheduleOption[] {
  const kinds = kindsForCategory(input.category);
  if (!kinds) return [];
  const kindSet = new Set(kinds);
  const result: CashLoanScheduleOption[] = [];

  for (const loan of input.loans.filter((item) => item.status === "active")) {
    const companyId = loanCompanyId(loan.id, input.payments, input.paymentCompanies);
    const storedRows = input.scheduleRows.filter((row) => row.loanId === loan.id);
    if (storedRows.length) {
      const grouped = new Map<string, ScheduleRowRecord[]>();
      for (const row of storedRows) {
        if (row.status !== "planned" || !kindSet.has(row.kind)) continue;
        grouped.set(row.dueDate, [...(grouped.get(row.dueDate) ?? []), row]);
      }
      for (const [dueDate, rows] of grouped) {
        const amount = rows.reduce((sum, row) => sum + row.amountRub, 0);
        result.push({
          key: `rows:${loan.id}:${dueDate}:${kinds.join("+")}`,
          loanId: loan.id,
          loanName: loanOptionLabel(loan),
          companyId,
          dueDate,
          amount,
          rowIds: rows.map((row) => row.id),
          legacyPaymentIds: [],
          label: `${dueDate} · ${kindLabel(kinds)} · ${amount.toLocaleString("ru-RU")} ₽`,
        });
      }
      continue;
    }

    // Старые графики до loan_schedule_rows: части хранятся плановыми
    // платежами с меткой [loan:<id>:schedule:<row>:<kind>].
    const grouped = new Map<string, Payment[]>();
    for (const payment of input.payments) {
      if (payment.status !== "planned") continue;
      const match = payment.comment?.match(/\[loan:([^:\]]+):schedule:[^:\]]+:(principal|interest|penalty|fine)\]/);
      if (!match || match[1] !== loan.id || !kindSet.has(match[2] as ScheduleRowKind)) continue;
      grouped.set(payment.date, [...(grouped.get(payment.date) ?? []), payment]);
    }
    for (const [dueDate, rows] of grouped) {
      const amount = rows.reduce((sum, payment) => sum + Math.abs(payment.amount), 0);
      result.push({
        key: `legacy:${loan.id}:${dueDate}:${kinds.join("+")}`,
        loanId: loan.id,
        loanName: loanOptionLabel(loan),
        companyId,
        dueDate,
        amount,
        rowIds: [],
        legacyPaymentIds: rows.map((payment) => payment.id),
        label: `${dueDate} · ${kindLabel(kinds)} · ${amount.toLocaleString("ru-RU")} ₽`,
      });
    }
  }

  return result.sort((left, right) => left.dueDate.localeCompare(right.dueDate) || left.loanName.localeCompare(right.loanName, "ru"));
}

export function loanPaymentNeedsConfirmation(actualAmount: number, scheduledAmount: number) {
  return Math.abs(Math.abs(actualAmount) - scheduledAmount) > Math.max(0.01, scheduledAmount * 0.01);
}

function daysBetween(left: string, right: string) {
  const leftTime = Date.parse(`${left}T12:00:00Z`);
  const rightTime = Date.parse(`${right}T12:00:00Z`);
  return Number.isFinite(leftTime) && Number.isFinite(rightTime) ? Math.abs(leftTime - rightTime) / 86_400_000 : Number.MAX_SAFE_INTEGER;
}

/** Ближайшая строка подставляется как предложение; человек всё ещё может выбрать другую. */
export function closestCashLoanScheduleOption(options: readonly CashLoanScheduleOption[], date: string, amount: number) {
  return [...options].sort((left, right) =>
    daysBetween(left.dueDate, date) - daysBetween(right.dueDate, date)
    || Math.abs(left.amount - Math.abs(amount)) - Math.abs(right.amount - Math.abs(amount))
    || left.dueDate.localeCompare(right.dueDate))[0];
}
