// Логика свода ДДС: раскладка статей по разделам движения денежных средств.
// Раздел деривируется из статьи (как в исходной таблице, колонка «Вид д-ти»).

// Своду достаточно знака суммы, статьи и даты — подходят и платежи, и черновики импорта.
export type DdsSummaryInput = {
  amount: number;
  category: string;
  date: string;
  status?: string;
};

export type DdsSection = "Операционная" | "Инвестиционная" | "Финансовая" | "Техническая" | "Прочее";

export const DDS_SECTION_ORDER: DdsSection[] = [
  "Операционная",
  "Инвестиционная",
  "Финансовая",
  "Техническая",
  "Прочее",
];

// Технический раздел (переводы между своими счетами) не входит в «реальный» итог.
export const TECHNICAL_SECTION: DdsSection = "Техническая";

const SECTION_BY_CATEGORY: Record<string, DdsSection> = {
  // Операционная
  "Продажи на МП": "Операционная",
  "Закуп товара": "Операционная",
  "РКО": "Операционная",
  "УСН": "Операционная",
  "ПО": "Операционная",
  "Кешбэк": "Операционная",
  "Выкупы": "Операционная",
  "Внутренняя реклама на МП": "Операционная",
  "Оплата услуг склада": "Операционная",
  "Доставка до маркеплейса": "Операционная",
  "Доставка до МСК": "Операционная",
  "Доставка по МСК": "Операционная",
  "Упаковочные материалы": "Операционная",
  "Маркетинговые подрядчики": "Операционная",
  "Административные подрядчики": "Операционная",
  "Зарплата административного персонала": "Операционная",
  "Зарплата коммерческого персонала": "Операционная",
  "Зарплата производственного персонала": "Операционная",
  "Фулфилмент": "Операционная",
  // Финансовая
  "Дивиденды": "Финансовая",
  "Вклады от собственников": "Финансовая",
  "Получение кредитов и займов": "Финансовая",
  "Оплаты по кредитам и займам": "Финансовая",
  "Оплата % по кредиту": "Финансовая",
  "Возврат ошибочного платежа": "Финансовая",
  // Инвестиционная
  "Выдача кредитов и займов": "Инвестиционная",
  "Воврат кредитов и займов": "Инвестиционная",
  "Возврат кредитов и займов": "Инвестиционная",
  "Прочие поступл. от фин. операций": "Инвестиционная",
  // Техническая
  "Выбытие — Перевод между счетами": "Техническая",
  "Поступление — Перевод между счетами": "Техническая",
};

export function sectionForCategory(category: string): DdsSection {
  return SECTION_BY_CATEGORY[category] ?? "Прочее";
}

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
