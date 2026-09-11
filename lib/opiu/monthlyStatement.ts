export type MonthlyOpiuStatus = "complete" | "partial" | "missing" | "na";
export type MonthlyOpiuDirection = "wb" | "ozon" | "shared";

export interface MonthlyOpiuAmount {
  value: number | null;
  known: number;
  status: MonthlyOpiuStatus;
  note?: string;
}

export type MonthlyOpiuSection =
  | "revenue"
  | "variable"
  | "direct_fixed"
  | "manufacturing"
  | "administrative"
  | "commercial"
  | "below_income"
  | "below_expense";

export interface MonthlyOpiuArticle {
  id: string;
  label: string;
  section: MonthlyOpiuSection;
  source: string;
  description: string;
}

export interface MarketplaceMonthlyActual {
  wb?: {
    revenue_before_spp: number;
    commission: number;
    acquiring: number;
    ad: number;
    other: number;
    cogs: number;
    logistics: number | null;
    storage: number | null;
    penalty: number | null;
    warnings?: string[];
    error?: string;
  };
  ozon?: {
    revenue: number;
    commission: number;
    delivery: number;
    services: number;
    cogs: number;
    warnings?: string[];
    error?: string;
    noCabinet?: boolean;
  };
  shared?: Record<string, {
    amount: number;
    status: "complete" | "partial";
    note?: string;
  }>;
}

export interface MonthlyOpiuRow {
  id: string;
  label: string;
  kind: "section" | "article" | "subtotal" | "result" | "percent";
  source?: string;
  description?: string;
  section?: MonthlyOpiuSection;
  amounts: Record<MonthlyOpiuDirection | "total", MonthlyOpiuAmount>;
}

export interface MonthlyOpiuStatement {
  rows: MonthlyOpiuRow[];
  revenue: MonthlyOpiuAmount;
  ebitda: MonthlyOpiuAmount;
  netProfit: MonthlyOpiuAmount;
  netMargin: MonthlyOpiuAmount;
  coverage: { complete: number; partial: number; missing: number; total: number };
}

// Кодовый справочник повторяет статьи листа «Статьи» исходной модели. Коды
// стабильны и не зависят от текста, чтобы последующие импорты плана могли
// ссылаться на статью без хрупкого сопоставления по названию.
export const MONTHLY_OPIU_ARTICLES: readonly MonthlyOpiuArticle[] = [
  { id: "marketplace_sales", label: "Продажи на МП", section: "revenue", source: "Финансовые отчёты маркетплейсов", description: "Выручка от продаж на маркетплейсах" },
  { id: "cogs", label: "Себестоимость", section: "variable", source: "Финансовые отчёты и таблица себестоимости", description: "Себестоимость проданного товара" },
  { id: "warehouse_packaging", label: "Склад (упаковка, отгрузка)", section: "variable", source: "Таблица себестоимости", description: "Упаковка, маркировка и отгрузка" },
  { id: "marketplace_commission", label: "Комиссия маркетплейсов", section: "variable", source: "Финансовые отчёты маркетплейсов", description: "Комиссия за реализацию товара" },
  { id: "marketplace_logistics", label: "Логистика маркетплейсов", section: "variable", source: "Финансовые отчёты маркетплейсов", description: "Логистика при реализации товара" },
  { id: "marketplace_other", label: "Прочие удержания МП", section: "variable", source: "Финансовые отчёты маркетплейсов", description: "Эквайринг, хранение, штрафы и другие удержания" },
  { id: "marketplace_ads", label: "Реклама на МП", section: "direct_fixed", source: "Рекламные кабинеты маркетплейсов", description: "Внутренняя реклама в кабинетах WB и Ozon" },
  { id: "external_ads", label: "Реклама внешняя (блогеры)", section: "direct_fixed", source: "ДДС", description: "Покупка внешнего трафика и размещения у блогеров" },
  { id: "barter", label: "Бартеры внешка/раздачи менеджеров", section: "direct_fixed", source: "ДДС", description: "Выкуп товара за отзыв на маркетплейсе" },
  { id: "cashback", label: "Кэшбек", section: "direct_fixed", source: "Google-таблица, ДДС", description: "Оплата за отзыв" },
  { id: "external_target_ads", label: "Реклама внешняя (таргет, директ)", section: "direct_fixed", source: "ДДС", description: "Покупка трафика в рекламных системах" },
  { id: "fulfillment", label: "Фулфилмент", section: "manufacturing", source: "ДДС", description: "Оплата услуг фулфилмента" },
  { id: "transport", label: "Транспортные расходы", section: "manufacturing", source: "ДДС", description: "Транспортные расходы до Москвы и по Москве" },
  { id: "admin_salary", label: "Зарплата административного персонала", section: "administrative", source: "Зарплатная ведомость", description: "Начисленная зарплата административного персонала" },
  { id: "bank_fees", label: "РКО", section: "administrative", source: "Выписка расчётного счёта", description: "Обслуживание счетов и комиссии за платежи" },
  { id: "payroll_taxes", label: "Налоги на ФОТ", section: "administrative", source: "Зарплатная ведомость", description: "Начисленные налоги на фонд оплаты труда" },
  { id: "training", label: "Обучение персонала", section: "administrative", source: "ДДС", description: "Курсы и профессиональное обучение" },
  { id: "personnel", label: "Расходы на персонал", section: "administrative", source: "ДДС", description: "Корпоративные мероприятия и подарки сотрудникам" },
  { id: "recruitment", label: "Поиск и найм персонала", section: "administrative", source: "ДДС", description: "Рекрутинг и размещение вакансий" },
  { id: "admin_contractors", label: "Административные подрядчики", section: "administrative", source: "Учёт ДЗ и КЗ", description: "Финансовый, юридический и бухгалтерский консалтинг" },
  { id: "software", label: "ПО", section: "administrative", source: "Учёт РБП, ДДС", description: "Оплата программного обеспечения и сервисов" },
  { id: "office", label: "Аренда и содержание офиса", section: "administrative", source: "ДДС", description: "Аренда и коммунальные расходы офиса" },
  { id: "cash_withdrawal", label: "Вывод денег", section: "administrative", source: "ДДС", description: "Вывод денежных средств" },
  { id: "commercial_salary", label: "Зарплата коммерческого персонала", section: "commercial", source: "Зарплатная ведомость", description: "Начисленная зарплата коммерческого персонала" },
  { id: "self_purchases", label: "Самовыкупы", section: "commercial", source: "Таблица по выкупам", description: "Оплата сервиса по выкупам" },
  { id: "marketing_contractors", label: "Маркетинговые подрядчики", section: "commercial", source: "Учёт ДЗ и КЗ", description: "Подрядчики по маркетингу, рекламе и контенту" },
  { id: "exchange_gain", label: "Курсовая разница +", section: "below_income", source: "ДДС", description: "Положительная курсовая разница" },
  { id: "exchange_loss", label: "Курсовая разница -", section: "below_expense", source: "ДДС", description: "Отрицательная курсовая разница" },
  { id: "taxes", label: "Налоги", section: "below_expense", source: "Учёт налогов", description: "Начисленные налоги за период" },
  { id: "depreciation", label: "Амортизация", section: "below_expense", source: "Учёт основных средств", description: "Амортизация оборудования" },
  { id: "loan_interest", label: "Выплаты процентов по займам и кредитам", section: "below_expense", source: "Учёт финансовой деятельности", description: "Проценты по займам и кредитам" },
  { id: "vat", label: "НДС", section: "below_expense", source: "Учёт НДС", description: "Начисленный НДС" },
] as const;

const complete = (value: number, note?: string): MonthlyOpiuAmount => ({ value, known: value, status: "complete", note });
const partial = (known: number, note: string): MonthlyOpiuAmount => ({ value: null, known, status: "partial", note });
const missing = (note: string): MonthlyOpiuAmount => ({ value: null, known: 0, status: "missing", note });
const na = (): MonthlyOpiuAmount => ({ value: null, known: 0, status: "na" });

function sumAmounts(amounts: MonthlyOpiuAmount[]): MonthlyOpiuAmount {
  const relevant = amounts.filter((amount) => amount.status !== "na");
  if (!relevant.length) return na();
  const known = relevant.reduce((sum, amount) => sum + amount.known, 0);
  if (relevant.every((amount) => amount.status === "complete")) return complete(known);
  const notes = relevant.flatMap((amount) => amount.note ? [amount.note] : []);
  return {
    value: null,
    known,
    status: relevant.some((amount) => amount.status === "partial" || amount.status === "complete") ? "partial" : "missing",
    note: [...new Set(notes)].join("; ") || "Источник ещё не подключён",
  };
}

function subtractAmounts(left: MonthlyOpiuAmount, right: MonthlyOpiuAmount): MonthlyOpiuAmount {
  if (left.status === "na" || right.status === "na") return na();
  const known = left.known - right.known;
  if (left.status === "complete" && right.status === "complete") return complete(known);
  return {
    value: null,
    known,
    status: left.status === "missing" && right.status === "missing" ? "missing" : "partial",
    note: "Результат рассчитан только по доступным статьям",
  };
}

function addAmounts(left: MonthlyOpiuAmount, right: MonthlyOpiuAmount): MonthlyOpiuAmount {
  return sumAmounts([left, right]);
}

function percentAmount(numerator: MonthlyOpiuAmount, revenue: MonthlyOpiuAmount): MonthlyOpiuAmount {
  const known = revenue.known !== 0 ? numerator.known / revenue.known * 100 : 0;
  if (numerator.status === "complete" && revenue.status === "complete" && revenue.value) return complete((numerator.value ?? 0) / revenue.value * 100);
  return { value: null, known, status: numerator.status === "missing" ? "missing" : "partial", note: numerator.note };
}

function directions(
  wb: MonthlyOpiuAmount,
  ozon: MonthlyOpiuAmount,
  shared: MonthlyOpiuAmount,
): MonthlyOpiuRow["amounts"] {
  return { wb, ozon, shared, total: sumAmounts([wb, ozon, shared]) };
}

const emptyAmounts = (): MonthlyOpiuRow["amounts"] => directions(na(), na(), na());

function resultDirections(
  operation: (left: MonthlyOpiuAmount, right: MonthlyOpiuAmount) => MonthlyOpiuAmount,
  left: MonthlyOpiuRow["amounts"],
  right: MonthlyOpiuRow["amounts"],
): MonthlyOpiuRow["amounts"] {
  return {
    wb: operation(left.wb, right.wb),
    ozon: operation(left.ozon, right.ozon),
    shared: operation(left.shared, right.shared),
    total: operation(left.total, right.total),
  };
}

export function buildMonthlyOpiuStatement(actual: MarketplaceMonthlyActual): MonthlyOpiuStatement {
  const wbReady = actual.wb && !actual.wb.error;
  const ozonReady = actual.ozon && !actual.ozon.error && !actual.ozon.noCabinet;
  const wbWarnings = actual.wb?.warnings ?? [];
  const wbCogsIncomplete = wbReady && wbWarnings.some((warning) => /себестоимост/i.test(warning));
  const wbRatesIncomplete = wbReady && wbWarnings.some((warning) => /финотч|комисси|став/i.test(warning));
  const ozonWarning = ozonReady && (actual.ozon?.warnings?.length ?? 0) > 0;
  const unavailableWb = missing(actual.wb?.error || "Данные WB недоступны");
  const unavailableOzon = missing(actual.ozon?.error || (actual.ozon?.noCabinet ? "Кабинет Ozon не подключён" : "Данные Ozon недоступны"));

  const articleAmounts = new Map<string, MonthlyOpiuRow["amounts"]>();
  const marketplace = (wb: MonthlyOpiuAmount, ozon: MonthlyOpiuAmount) => directions(wb, ozon, na());
  articleAmounts.set("marketplace_sales", marketplace(
    wbReady ? complete(actual.wb!.revenue_before_spp) : unavailableWb,
    ozonReady ? (ozonWarning ? partial(actual.ozon!.revenue, "Не все кабинеты Ozon вернули данные") : complete(actual.ozon!.revenue)) : unavailableOzon,
  ));
  articleAmounts.set("cogs", marketplace(
    wbReady ? (wbCogsIncomplete ? partial(actual.wb!.cogs, "Часть SKU WB без себестоимости") : complete(actual.wb!.cogs)) : unavailableWb,
    ozonReady ? (ozonWarning ? partial(actual.ozon!.cogs, "Себестоимость Ozon рассчитана не по всем кабинетам") : complete(actual.ozon!.cogs)) : unavailableOzon,
  ));
  articleAmounts.set("marketplace_commission", marketplace(
    wbReady ? (wbRatesIncomplete ? partial(actual.wb!.commission, "Комиссия WB частично оценена по доступным ставкам") : complete(actual.wb!.commission)) : unavailableWb,
    ozonReady ? (ozonWarning ? partial(actual.ozon!.commission, "Не все кабинеты Ozon вернули данные") : complete(actual.ozon!.commission)) : unavailableOzon,
  ));
  articleAmounts.set("marketplace_logistics", marketplace(
    wbReady && actual.wb!.logistics != null ? complete(actual.wb!.logistics) : missing("Логистика WB пока не входит в месячный кэш"),
    ozonReady ? (ozonWarning ? partial(actual.ozon!.delivery, "Не все кабинеты Ozon вернули данные") : complete(actual.ozon!.delivery)) : unavailableOzon,
  ));
  articleAmounts.set("marketplace_other", marketplace(
    wbReady
      ? partial(actual.wb!.acquiring + actual.wb!.other + (actual.wb!.storage ?? 0) + (actual.wb!.penalty ?? 0), "В месячном кэше WB пока нет полного хранения и штрафов")
      : unavailableWb,
    ozonReady ? partial(actual.ozon!.services, "Ozon отдаёт рекламу, хранение и услуги одной суммой") : unavailableOzon,
  ));
  articleAmounts.set("marketplace_ads", marketplace(
    wbReady ? complete(actual.wb!.ad) : unavailableWb,
    ozonReady ? missing("Реклама Ozon не отделена от прочих услуг") : unavailableOzon,
  ));

  for (const article of MONTHLY_OPIU_ARTICLES) {
    if (!articleAmounts.has(article.id)) {
      const shared = actual.shared?.[article.id];
      const sharedAmount = shared
        ? shared.status === "complete" ? complete(shared.amount, shared.note) : partial(shared.amount, shared.note || "Источник учтён частично")
        : missing(`${article.source}: данные за месяц ещё не подключены`);
      articleAmounts.set(article.id, directions(na(), na(), sharedAmount));
    }
  }

  const articleRows = MONTHLY_OPIU_ARTICLES.map<MonthlyOpiuRow>((article) => ({
    ...article,
    kind: "article",
    amounts: articleAmounts.get(article.id)!,
  }));
  const bySection = (section: MonthlyOpiuSection) => articleRows.filter((row) => row.section === section);
  const subtotal = (id: string, label: string, section: MonthlyOpiuSection): MonthlyOpiuRow => {
    const children = bySection(section);
    return {
      id,
      label,
      kind: "subtotal",
      amounts: {
        wb: sumAmounts(children.map((row) => row.amounts.wb)),
        ozon: sumAmounts(children.map((row) => row.amounts.ozon)),
        shared: sumAmounts(children.map((row) => row.amounts.shared)),
        total: sumAmounts(children.map((row) => row.amounts.total)),
      },
    };
  };
  const result = (id: string, label: string, amounts: MonthlyOpiuRow["amounts"]): MonthlyOpiuRow => ({ id, label, kind: "result", amounts });
  const percent = (id: string, label: string, numerator: MonthlyOpiuRow["amounts"], revenue: MonthlyOpiuRow["amounts"]): MonthlyOpiuRow => ({
    id,
    label,
    kind: "percent",
    amounts: {
      wb: percentAmount(numerator.wb, revenue.wb),
      ozon: percentAmount(numerator.ozon, revenue.ozon),
      shared: na(),
      total: percentAmount(numerator.total, revenue.total),
    },
  });
  const section = (id: string, label: string): MonthlyOpiuRow => ({ id, label, kind: "section", amounts: emptyAmounts() });

  const revenue = subtotal("revenue_total", "Выручка", "revenue");
  const variable = subtotal("variable_total", "Переменные расходы", "variable");
  const marginalAmounts = resultDirections(subtractAmounts, revenue.amounts, variable.amounts);
  const directFixed = subtotal("direct_fixed_total", "Прямые постоянные", "direct_fixed");
  const directionGrossAmounts = resultDirections(subtractAmounts, marginalAmounts, directFixed.amounts);
  const manufacturing = subtotal("manufacturing_total", "Общепроизводственные", "manufacturing");
  const grossAmounts = resultDirections(subtractAmounts, directionGrossAmounts, manufacturing.amounts);
  const administrative = subtotal("administrative_total", "Административные", "administrative");
  const commercial = subtotal("commercial_total", "Коммерческие", "commercial");
  const indirectAmounts = resultDirections(addAmounts, administrative.amounts, commercial.amounts);
  const ebitdaAmounts = resultDirections(subtractAmounts, grossAmounts, indirectAmounts);
  const belowIncome = subtotal("below_income_total", "Доходы ниже EBITDA", "below_income");
  const belowExpense = subtotal("below_expense_total", "Расходы ниже EBITDA", "below_expense");
  const afterIncome = resultDirections(addAmounts, ebitdaAmounts, belowIncome.amounts);
  const netProfitAmounts = resultDirections(subtractAmounts, afterIncome, belowExpense.amounts);

  const rows: MonthlyOpiuRow[] = [
    revenue,
    ...bySection("revenue"),
    section("section_production", "Производственные расходы"),
    variable,
    ...bySection("variable"),
    result("marginal_income", "Маржинальный доход", marginalAmounts),
    percent("marginal_margin", "Рентабельность по маржинальному доходу, %", marginalAmounts, revenue.amounts),
    directFixed,
    ...bySection("direct_fixed"),
    result("direction_gross", "Валовая прибыль по направлениям", directionGrossAmounts),
    percent("direction_gross_margin", "Рентабельность по направлениям, %", directionGrossAmounts, revenue.amounts),
    manufacturing,
    ...bySection("manufacturing"),
    result("gross_profit", "Валовая прибыль", grossAmounts),
    percent("gross_margin", "Рентабельность по валовой прибыли, %", grossAmounts, revenue.amounts),
    section("section_indirect", "Косвенные расходы"),
    administrative,
    ...bySection("administrative"),
    commercial,
    ...bySection("commercial"),
    result("ebitda", "Операционная прибыль (EBITDA)", ebitdaAmounts),
    percent("ebitda_margin", "Рентабельность по операционной прибыли, %", ebitdaAmounts, revenue.amounts),
    belowIncome,
    ...bySection("below_income"),
    belowExpense,
    ...bySection("below_expense"),
    result("net_profit", "Чистая прибыль", netProfitAmounts),
    percent("net_margin", "Рентабельность по чистой прибыли, %", netProfitAmounts, revenue.amounts),
  ];
  const totals = articleRows.map((row) => row.amounts.total);
  const coverage = {
    complete: totals.filter((amount) => amount.status === "complete").length,
    partial: totals.filter((amount) => amount.status === "partial").length,
    missing: totals.filter((amount) => amount.status === "missing").length,
    total: totals.length,
  };
  return {
    rows,
    revenue: revenue.amounts.total,
    ebitda: ebitdaAmounts.total,
    netProfit: netProfitAmounts.total,
    netMargin: percentAmount(netProfitAmounts.total, revenue.amounts.total),
    coverage,
  };
}
