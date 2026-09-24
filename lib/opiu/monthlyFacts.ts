import { isDdsActualPayment } from "@/lib/finance/bankDdsPayment";
import type { Payment } from "@/lib/types";
import { payrollCategoryForEmployee } from "@/lib/payroll/model";
import { DDS_OPIU_EXPENSE_TARGETS, type DdsExpenseCategory } from "@/lib/finance/expenseCategories";

export interface MonthlySharedFact {
  amount: number;
  status: "complete" | "partial";
  note?: string;
}

export interface DdsFactRow {
  id?: string;
  date?: string;
  amount: number;
  category: string | null;
  comment?: string | null;
  counterparty?: string | null;
  name?: string | null;
  companyId?: string | null;
  status: Payment["status"];
  importSource: string | null;
}

export interface PayrollPeriodFact {
  id: string;
  periodStart: string;
  periodEnd: string;
}

export interface PayrollEntryFact {
  id?: string;
  periodId: string;
  employeeId: string;
  officialAmount: number;
  unofficialAmount: number;
  contractorAmount: number;
  taxAmount: number;
  companyId?: string | null;
  lines?: Array<{
    kind?: "official" | "unofficial" | "contractor";
    amount?: number;
    taxAmount?: number;
    companyId?: string | null;
  }> | null;
}

export interface PayrollEmployeeFact {
  id: string;
  fullName?: string;
  position: string;
  employmentType?: "official" | "unofficial" | "partial" | "individual_entrepreneur" | "self_employed";
}

const DDS_TO_OPIU: Readonly<Record<string, string>> = {
  "РКО": "bank_fees",
  "Фулфилмент": "fulfillment",
  "Оплата услуг склада": "fulfillment",
  "Доставка до маркеплейса": "transport",
  "Доставка до МСК": "transport",
  "Доставка по МСК": "transport",
  "Поиск и найм персонала": "recruitment",
  "Расходы на персонал": "personnel",
  "Маркетинговые подрядчики": "marketing_contractors",
  "Административные подрядчики": "admin_contractors",
  "ПО": "software",
  "Выкупы": "self_purchases",
  "Кешбэк": "cashback",
  "Кэшбек": "cashback",
};

export interface LoanScheduleMonthlyFact {
  id?: string;
  loanId?: string;
  dueDate?: string;
  amount: number;
  kind: "interest" | "penalty" | "fine" | "fee";
  status: "planned" | "paid" | "cancelled";
  companyId?: string | null;
}

export interface LoanReceiptCompanyFact {
  companyId: string | null;
  comment: string | null;
}

/**
 * Компания договора хранится на приходе кредита. Это резервный источник для
 * старых/частично пересохранённых графиков, где у отдельного календарного
 * платежа company_id мог остаться пустым.
 *
 * Если один договор по ошибке связан с разными компаниями, ничего не угадываем:
 * такой договор должен быть исправлен вручную, а не попасть не в то юрлицо.
 */
export function loanCompanyByReceiptPayments(rows: readonly LoanReceiptCompanyFact[]): Map<string, string> {
  const result = new Map<string, string>();
  const conflicts = new Set<string>();
  for (const row of rows) {
    if (!row.companyId) continue;
    const loanId = row.comment?.match(/\[loan:([0-9a-f-]{36}):receipt\]/i)?.[1]?.toLowerCase();
    if (!loanId || conflicts.has(loanId)) continue;
    const current = result.get(loanId);
    if (current && current !== row.companyId) {
      result.delete(loanId);
      conflicts.add(loanId);
      continue;
    }
    result.set(loanId, row.companyId);
  }
  return result;
}

/**
 * ОПиУ работает по начислению: проценты и комиссии берём из графика за месяц,
 * независимо от того, успел ли платёж перейти из плана в факт. Тело кредита
 * здесь намеренно не учитывается — это движение баланса, а не расход.
 */
export function aggregateLoanScheduleMonthlyFacts(
  rows: readonly LoanScheduleMonthlyFact[],
  companyIds: readonly string[] = [],
): Record<string, MonthlySharedFact> {
  const selected = new Set(companyIds);
  const relevant = rows.filter((row) =>
    row.kind === "interest" &&
    row.status !== "cancelled" &&
    (!selected.size || (row.companyId ? selected.has(row.companyId) : false)),
  );
  if (!relevant.length) return {};
  const amount = Math.round(relevant.reduce((total, row) => total + Math.abs(Number(row.amount) || 0), 0) * 100) / 100;
  return {
    loan_interest: {
      amount,
      status: "complete",
      note: "Начисленные проценты по графикам кредитов за месяц",
    },
  };
}

function add(target: Map<string, number>, id: string, value: number) {
  target.set(id, Math.round(((target.get(id) ?? 0) + value) * 100) / 100);
}

export function ddsOpiuArticleId(
  row: DdsFactRow,
  customCategories: readonly DdsExpenseCategory[] = [],
): string | null {
  if (!isDdsActualPayment(row) || row.amount >= 0) return null;
  if (String(row.comment ?? "").includes("[payroll:")) return null;
  const accrualOnlyTargets = new Set(["taxes", "vat", "loan_interest"]);
  const allowedTargets = new Set(DDS_OPIU_EXPENSE_TARGETS.map((article) => article.id).filter((id) => !accrualOnlyTargets.has(id)));
  const category = String(row.category ?? "").trim();
  const custom = customCategories.find((item) => item.name === category)?.opiuArticleId ?? null;
  const id = DDS_TO_OPIU[category] ?? custom;
  return id && allowedTargets.has(id) ? id : null;
}

export function aggregateDdsMonthlyFacts(rows: readonly DdsFactRow[], customCategories: readonly DdsExpenseCategory[] = []): Record<string, MonthlySharedFact> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const id = ddsOpiuArticleId(row, customCategories);
    if (!id) continue;
    add(totals, id, Math.abs(Number(row.amount) || 0));
  }
  return Object.fromEntries([...totals].map(([id, amount]) => [id, {
    amount,
    status: "complete" as const,
    note: "Подтверждённые платежи ДДС с учётом распределения по месяцам ОПиУ",
  }]));
}

export interface PayrollMonthlyContribution {
  articleId: "admin_salary" | "commercial_salary" | "payroll_taxes";
  amount: number;
  companyId?: string | null;
}

export function payrollMonthlyContributions(
  entry: PayrollEntryFact,
  employee: PayrollEmployeeFact,
  companyIds: readonly string[] = [],
): PayrollMonthlyContribution[] {
  const selectedCompanyIds = new Set(companyIds);
  const companySelected = selectedCompanyIds.size > 0;
  const selectedLines = entry.lines?.length
    ? entry.lines.filter((line) => !companySelected || (line.companyId ? selectedCompanyIds.has(line.companyId) : false))
    : null;
  if (companySelected && !selectedLines && (!entry.companyId || !selectedCompanyIds.has(entry.companyId))) return [];
  if (companySelected && selectedLines?.length === 0) return [];

  const salary = selectedLines
    ? selectedLines.reduce((sum, line) => {
      const amount = Number(line.amount) || 0;
      const contractorTax = line.kind === "contractor" ? Number(line.taxAmount) || 0 : 0;
      return sum + amount + contractorTax;
    }, 0)
    : entry.officialAmount + entry.unofficialAmount + entry.contractorAmount
      + ((employee.employmentType === "individual_entrepreneur"
        || employee.employmentType === "self_employed"
        || (entry.contractorAmount > 0 && entry.officialAmount === 0 && entry.unofficialAmount === 0))
        ? entry.taxAmount
        : 0);
  const tax = selectedLines
    ? selectedLines.reduce((sum, line) => {
      if (line.kind !== "contractor" && line.kind !== "unofficial") return sum + (Number(line.taxAmount) || 0);
      return sum;
    }, 0)
    : (employee.employmentType === "individual_entrepreneur"
      || employee.employmentType === "self_employed"
      || (entry.contractorAmount > 0 && entry.officialAmount === 0 && entry.unofficialAmount === 0))
      ? 0
      : entry.taxAmount;
  const category = payrollCategoryForEmployee(employee.position);
  const result: PayrollMonthlyContribution[] = [];
  if (category === "administrative") result.push({ articleId: "admin_salary", amount: salary, companyId: entry.companyId });
  if (category === "commercial") result.push({ articleId: "commercial_salary", amount: salary, companyId: entry.companyId });
  result.push({ articleId: "payroll_taxes", amount: tax, companyId: entry.companyId });
  return result;
}

function coversMonth(periods: readonly PayrollPeriodFact[], from: string, to: string): boolean {
  if (!periods.length) return false;
  const ranges = periods
    .map((period) => [period.periodStart, period.periodEnd] as const)
    .sort((left, right) => left[0].localeCompare(right[0]));
  let coveredTo = "";
  for (const [start, end] of ranges) {
    if (end < from || start > to) continue;
    if (!coveredTo && start > from) return false;
    if (coveredTo) {
      const nextDay = new Date(`${coveredTo}T00:00:00Z`);
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      if (start > nextDay.toISOString().slice(0, 10)) return false;
    }
    if (end > coveredTo) coveredTo = end;
  }
  return coveredTo >= to;
}

export function aggregatePayrollMonthlyFacts(input: {
  periods: readonly PayrollPeriodFact[];
  entries: readonly PayrollEntryFact[];
  employees: readonly PayrollEmployeeFact[];
  from: string;
  to: string;
  companyId?: string | null;
  companyIds?: readonly string[];
}): Record<string, MonthlySharedFact> {
  if (!input.periods.length || !input.entries.length) return {};
  const periodIds = new Set(input.periods.map((period) => period.id));
  const employeeById = new Map(input.employees.map((employee) => [employee.id, employee]));
  const selectedCompanyIds = input.companyIds?.length ? input.companyIds : input.companyId ? [input.companyId] : [];
  const totals = new Map<string, number>([["admin_salary", 0], ["commercial_salary", 0], ["payroll_taxes", 0]]);
  for (const entry of input.entries) {
    if (!periodIds.has(entry.periodId)) continue;
    const employee = employeeById.get(entry.employeeId);
    if (!employee) continue;
    // В ОПиУ подрядчик (ИП/самозанятый) стоит компании сумму выплаты вместе
    // с компенсируемым ему налогом. У официальной части налог, наоборот,
    // является отдельной статьёй «Налоги на ФОТ». Долг сотруднику и платежи
    // календаря эту переклассификацию не используют: там налог по-прежнему
    // остаётся отдельным платежом в ФНС.
    for (const contribution of payrollMonthlyContributions(entry, employee, selectedCompanyIds)) {
      add(totals, contribution.articleId, contribution.amount);
    }
  }
  const complete = coversMonth(input.periods, input.from, input.to);
  return Object.fromEntries([...totals].map(([id, amount]) => [id, {
    amount,
    status: complete ? "complete" as const : "partial" as const,
    note: complete ? "Начисления зарплатной ведомости за полный месяц" : "Ведомость заполнена не за весь месяц",
  }]));
}

export function mergeMonthlySharedFacts(...sources: Array<Record<string, MonthlySharedFact>>): Record<string, MonthlySharedFact> {
  const result: Record<string, MonthlySharedFact> = {};
  for (const source of sources) {
    for (const [id, fact] of Object.entries(source)) {
      const current = result[id];
      if (!current) {
        result[id] = { ...fact };
        continue;
      }
      result[id] = {
        amount: Math.round((current.amount + fact.amount) * 100) / 100,
        status: current.status === "complete" && fact.status === "complete" ? "complete" : "partial",
        note: [current.note, fact.note].filter(Boolean).join("; "),
      };
    }
  }
  return result;
}
