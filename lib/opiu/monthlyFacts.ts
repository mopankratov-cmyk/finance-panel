import { LOAN_CATEGORIES } from "@/lib/finance/categories";
import { payrollCategoryForEmployee } from "@/lib/payroll/model";

export interface MonthlySharedFact {
  amount: number;
  status: "complete" | "partial";
  note?: string;
}

export interface DdsFactRow {
  amount: number;
  category: string | null;
  comment?: string | null;
}

export interface PayrollPeriodFact {
  id: string;
  periodStart: string;
  periodEnd: string;
}

export interface PayrollEntryFact {
  periodId: string;
  employeeId: string;
  officialAmount: number;
  unofficialAmount: number;
  contractorAmount: number;
  taxAmount: number;
  lines?: Array<{ amount?: number }> | null;
}

export interface PayrollEmployeeFact {
  id: string;
  position: string;
}

const DDS_TO_OPIU: Readonly<Record<string, string>> = {
  "РКО": "bank_fees",
  "Фулфилмент": "fulfillment",
  "Оплата услуг склада": "fulfillment",
  "Доставка до маркеплейса": "transport",
  "Доставка до МСК": "transport",
  "Доставка по МСК": "transport",
  "Упаковочные материалы": "warehouse_packaging",
  "Поиск и найм персонала": "recruitment",
  "Расходы на персонал": "personnel",
  "Маркетинговые подрядчики": "marketing_contractors",
  "Административные подрядчики": "admin_contractors",
  "ПО": "software",
  "Выкупы": "self_purchases",
  "Кешбэк": "cashback",
  "Кэшбек": "cashback",
  [LOAN_CATEGORIES.interest]: "loan_interest",
  "Оплата % по кредиту": "loan_interest",
};

function add(target: Map<string, number>, id: string, value: number) {
  target.set(id, Math.round(((target.get(id) ?? 0) + value) * 100) / 100);
}

export function aggregateDdsMonthlyFacts(rows: readonly DdsFactRow[]): Record<string, MonthlySharedFact> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const category = String(row.category ?? "").trim();
    const id = DDS_TO_OPIU[category];
    if (!id || row.amount >= 0) continue;
    // Зарплатная ведомость сама создаёт платежи в ДДС. Начисление берём из
    // ведомости ниже, поэтому её платежи здесь исключаем, иначе ФОТ удвоится.
    if (String(row.comment ?? "").includes("[payroll:")) continue;
    add(totals, id, Math.abs(Number(row.amount) || 0));
  }
  return Object.fromEntries([...totals].map(([id, amount]) => [id, {
    amount,
    status: "complete" as const,
    note: "Подтверждённые платежи ДДС за выбранный месяц",
  }]));
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
}): Record<string, MonthlySharedFact> {
  if (!input.periods.length || !input.entries.length) return {};
  const periodIds = new Set(input.periods.map((period) => period.id));
  const employeeById = new Map(input.employees.map((employee) => [employee.id, employee]));
  const totals = new Map<string, number>([["admin_salary", 0], ["commercial_salary", 0], ["payroll_taxes", 0]]);
  for (const entry of input.entries) {
    if (!periodIds.has(entry.periodId)) continue;
    const employee = employeeById.get(entry.employeeId);
    if (!employee) continue;
    const salary = entry.lines?.length
      ? entry.lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0)
      : entry.officialAmount + entry.unofficialAmount + entry.contractorAmount;
    const category = payrollCategoryForEmployee(employee.position);
    if (category === "administrative") add(totals, "admin_salary", salary);
    if (category === "commercial") add(totals, "commercial_salary", salary);
    // Производственный ФОТ не кладём в фулфилмент: в исходной модели эта
    // статья означает внешние услуги, а отдельной строки зарплаты склада нет.
    add(totals, "payroll_taxes", entry.taxAmount);
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
