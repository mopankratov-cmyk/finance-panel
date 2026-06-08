import type { Account, FinanceState } from "./types";

export const PAYMENT_CATEGORIES = [
  "Продажи на МП",
  "Закуп товара",
  "РКО",
  "Фулфилмент",
  "Зарплата административного персонала",
  "Зарплата коммерческого персонала",
  "Маркетинговые подрядчики",
  "Административные подрядчики",
  "ПО",
  "Получение кредитов и займов",
  "Оплаты по кредитам и займам",
  "Дивиденды",
  "УСН",
  "Внутренняя реклама на МП",
  "Оплата % по кредиту",
  "Оплата услуг склада",
  "Доставка до маркеплейса",
  "Выкупы",
  "Кешбэк",
  "Прочее",
] as const;

export const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  marketplace: "Маркетплейс",
  bank: "Банк",
  cash: "Наличные",
};

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  planned: "Запланирован",
  done: "Выполнен",
  cancelled: "Отменён",
};

export const LOAN_STATUS_LABELS: Record<string, string> = {
  active: "Активен",
  closed: "Закрыт",
};

const DEFAULT_ACCOUNTS: Account[] = [
  {
    id: "acc-1",
    name: "WB Счёт 1",
    type: "marketplace",
    currency: "RUB",
    balance: 450000,
  },
  {
    id: "acc-2",
    name: "WB Счёт 2",
    type: "marketplace",
    currency: "RUB",
    balance: 320000,
  },
  {
    id: "acc-3",
    name: "Ozon",
    type: "marketplace",
    currency: "RUB",
    balance: 180000,
  },
  {
    id: "acc-4",
    name: "Банковский счёт",
    type: "bank",
    currency: "RUB",
    balance: 1250000,
  },
  {
    id: "acc-5",
    name: "Наличные",
    type: "cash",
    currency: "RUB",
    balance: 50000,
  },
];

export const DEFAULT_STATE: FinanceState = {
  accounts: DEFAULT_ACCOUNTS,
  payments: [
    {
      id: "pay-1",
      date: getRelativeDate(2),
      name: "Выплата с Wildberries",
      amount: 85000,
      category: "Продажи на МП",
      accountId: "acc-1",
      status: "planned",
      counterparty: "Wildberries",
    },
    {
      id: "pay-2",
      date: getRelativeDate(3),
      name: "Закуп товара",
      amount: -320000,
      category: "Закуп товара",
      accountId: "acc-4",
      status: "planned",
      counterparty: "ООО Поставщик",
    },
    {
      id: "pay-3",
      date: getRelativeDate(5),
      name: "Зарплата коммерческого персонала",
      amount: -180000,
      category: "Зарплата коммерческого персонала",
      accountId: "acc-4",
      status: "planned",
      counterparty: "Сотрудники",
    },
    {
      id: "pay-4",
      date: getRelativeDate(-1),
      name: "Выплата с Ozon",
      amount: 42000,
      category: "Продажи на МП",
      accountId: "acc-3",
      status: "done",
      counterparty: "Ozon",
    },
    {
      id: "pay-5",
      date: getRelativeDate(1),
      name: "Фулфилмент",
      amount: -45000,
      category: "Фулфилмент",
      accountId: "acc-4",
      status: "planned",
      counterparty: "Склад ФФ",
    },
  ],
  loans: [
    {
      id: "loan-1",
      creditorName: "ООО Микрофинанс",
      principalAmount: 500000,
      interestRatePerDay: 0.05,
      startDate: getRelativeDate(-30),
      dueDate: getRelativeDate(60),
      status: "active",
    },
  ],
};

function getRelativeDate(daysFromToday: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  return d.toISOString().split("T")[0];
}
