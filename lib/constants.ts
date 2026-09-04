import { DDS_CATEGORIES } from "./finance/categories";
import type { Account, FinanceState } from "./types";

/** @deprecated Единый справочник статей — lib/finance/categories.ts; имя оставлено для старых импортов. */
export const PAYMENT_CATEGORIES = DDS_CATEGORIES;

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
    openingBalance: 450000,
    openingDate: getRelativeDate(0),
  },
  {
    id: "acc-2",
    name: "WB Счёт 2",
    type: "marketplace",
    currency: "RUB",
    balance: 320000,
    openingBalance: 320000,
    openingDate: getRelativeDate(0),
  },
  {
    id: "acc-3",
    name: "Ozon",
    type: "marketplace",
    currency: "RUB",
    balance: 180000,
    openingBalance: 180000,
    openingDate: getRelativeDate(0),
  },
  {
    id: "acc-4",
    name: "Банковский счёт",
    type: "bank",
    currency: "RUB",
    balance: 1250000,
    openingBalance: 1250000,
    openingDate: getRelativeDate(0),
  },
  {
    id: "acc-5",
    name: "Наличные",
    type: "cash",
    currency: "RUB",
    balance: 50000,
    openingBalance: 50000,
    openingDate: getRelativeDate(0),
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
