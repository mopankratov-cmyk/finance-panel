import { DDS_SECTION_ORDER, sectionForCategory, TECHNICAL_SECTION, type DdsSection } from "@/lib/finance/categories";

// Логика свода ДДС: раскладка статей по разделам движения денежных средств.
// Раздел деривируется из статьи (как в исходной таблице, колонка «Вид д-ти»).

// Своду достаточно знака суммы, статьи и даты — подходят и платежи, и черновики импорта.
export type DdsSummaryInput = {
  amount: number;
  category: string;
  date: string;
  status?: string;
};


// Раздел ДДС для статьи определяет единый справочник lib/finance/categories.ts.
// Здесь остались только реэкспорты — чтобы отчёт, экспорт и импорт не меняли импорты.
export { DDS_SECTION_ORDER, sectionForCategory, TECHNICAL_SECTION };
export type { DdsSection };

export interface DdsCategoryRow {
  category: string;
  income: number;
  expense: number; // положительное число
  net: number;
}

export interface DdsSectionGroup {
  section: DdsSection;
  rows: DdsCategoryRow[];
  income: number;
  expense: number;
  net: number;
}

export interface DdsSummary {
  groups: DdsSectionGroup[];
  // «реальные» итоги — без технического раздела (переводов между счетами)
  realIncome: number;
  realExpense: number;
  realNet: number;
  // валовые — со всеми движениями
  grossIncome: number;
  grossExpense: number;
  count: number;
}

export function buildDdsSummary(
  payments: DdsSummaryInput[],
  from?: string,
  to?: string,
): DdsSummary {
  // category -> {section, income, expense}
  const byCat = new Map<string, DdsCategoryRow>();
  let count = 0;

  for (const p of payments) {
    if (p.status === "planned" || p.status === "cancelled") continue; // свод — только факт
    if (from && p.date < from) continue;
    if (to && p.date > to) continue;
    count++;

    const cat = p.category || "Без статьи";
    const row = byCat.get(cat) ?? { category: cat, income: 0, expense: 0, net: 0 };
    if (p.amount >= 0) row.income += p.amount;
    else row.expense += -p.amount;
    row.net = row.income - row.expense;
    byCat.set(cat, row);
  }

  const groupMap = new Map<DdsSection, DdsSectionGroup>();
  for (const row of byCat.values()) {
    const section = sectionForCategory(row.category);
    const g =
      groupMap.get(section) ??
      ({ section, rows: [], income: 0, expense: 0, net: 0 } as DdsSectionGroup);
    g.rows.push(row);
    g.income += row.income;
    g.expense += row.expense;
    g.net = g.income - g.expense;
    groupMap.set(section, g);
  }

  const groups = DDS_SECTION_ORDER.filter((s) => groupMap.has(s)).map((s) => {
    const g = groupMap.get(s)!;
    g.rows.sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
    return g;
  });

  let realIncome = 0,
    realExpense = 0,
    grossIncome = 0,
    grossExpense = 0;
  for (const g of groups) {
    grossIncome += g.income;
    grossExpense += g.expense;
    if (g.section !== TECHNICAL_SECTION) {
      realIncome += g.income;
      realExpense += g.expense;
    }
  }

  return {
    groups,
    realIncome,
    realExpense,
    realNet: realIncome - realExpense,
    grossIncome,
    grossExpense,
    count,
  };
}
