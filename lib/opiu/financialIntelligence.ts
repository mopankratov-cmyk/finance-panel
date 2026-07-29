import type { Account, Payment } from "@/lib/types";

export type FinancialAlertSeverity = "critical" | "warning" | "info";

export interface FinancialAlert {
  key: string;
  severity: FinancialAlertSeverity;
  title: string;
  message: string;
  amount?: number;
  date?: string;
  action: string;
}

export interface FinancialIntelligenceResult {
  generatedAt: string;
  alerts: FinancialAlert[];
  planFact: {
    due: number;
    matched: number;
    unmatched: number;
    matchRate: number;
  };
  forecast: {
    lowestBalance: number;
    lowestBalanceDate: string | null;
    criticalPayments: number;
    overdueCritical: number;
  };
}

const dayDistance = (a: string, b: string) =>
  Math.abs(new Date(`${a}T00:00:00`).getTime() - new Date(`${b}T00:00:00`).getTime()) / 86_400_000;

const priority = (payment: Payment) =>
  payment.comment?.match(/\[priority:([ABC])\]/i)?.[1]?.toUpperCase() ?? "C";

export function analyzeFinances({
  accounts,
  payments,
  today = new Date().toISOString().slice(0, 10),
}: {
  accounts: Account[];
  payments: Payment[];
  today?: string;
}): FinancialIntelligenceResult {
  const active = payments.filter((payment) => payment.status !== "cancelled");
  const duePlans = active.filter((payment) => payment.status === "planned" && payment.date <= today);
  const facts = active.filter((payment) => payment.status === "done");
  const usedFacts = new Set<string>();
  let matched = 0;

  for (const plan of duePlans) {
    const fact = facts.find((candidate) =>
      !usedFacts.has(candidate.id) &&
      Math.sign(candidate.amount) === Math.sign(plan.amount) &&
      Math.abs(candidate.amount - plan.amount) <= Math.max(1, Math.abs(plan.amount) * 0.01) &&
      dayDistance(candidate.date, plan.date) <= 7 &&
      (candidate.accountId === plan.accountId || candidate.category === plan.category),
    );
    if (fact) {
      usedFacts.add(fact.id);
      matched++;
    }
  }

  const alerts: FinancialAlert[] = [];
  const overdueCritical = duePlans.filter((payment) => payment.amount < 0 && priority(payment) === "A");
  if (overdueCritical.length) {
    const amount = overdueCritical.reduce((sum, payment) => sum + Math.abs(payment.amount), 0);
    alerts.push({
      key: `overdue-a:${overdueCritical.map((payment) => payment.id).sort().join(",")}`,
      severity: "critical",
      title: "Просрочены критичные платежи A",
      message: `${overdueCritical.length} платежей на сумму ${Math.round(amount).toLocaleString("ru-RU")} ₽`,
      amount,
      action: "Проверить оплату или назначить новую дату",
    });
  }

  const currentBalance = accounts.reduce((sum, account) => sum + account.balance, 0);
  const future = active
    .filter((payment) => payment.status === "planned" && payment.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  let running = currentBalance;
  let lowestBalance = running;
  let lowestBalanceDate: string | null = null;
  for (const payment of future) {
    running += payment.amount;
    if (running < lowestBalance) {
      lowestBalance = running;
      lowestBalanceDate = payment.date;
    }
  }
  if (lowestBalance < 0) {
    alerts.push({
      key: `cash-gap:${lowestBalanceDate}:${Math.round(lowestBalance)}`,
      severity: "critical",
      title: "Ожидается кассовый разрыв",
      message: `Минимальный остаток ${Math.round(lowestBalance).toLocaleString("ru-RU")} ₽ на ${lowestBalanceDate}`,
      amount: lowestBalance,
      date: lowestBalanceDate ?? undefined,
      action: "Перенести платежи C, ускорить поступления или привлечь финансирование",
    });
  }

  const unmatched = duePlans.length - matched;
  const matchRate = duePlans.length ? matched / duePlans.length : 1;
  if (duePlans.length >= 3 && matchRate < 0.8) {
    alerts.push({
      key: `plan-fact:${duePlans.length}:${matched}`,
      severity: matchRate < 0.5 ? "critical" : "warning",
      title: "План заметно расходится с фактом",
      message: `Совпало ${matched} из ${duePlans.length} наступивших платежей`,
      action: "Открыть расхождения и уточнить суммы или даты",
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    alerts,
    planFact: {
      due: duePlans.length,
      matched,
      unmatched,
      matchRate,
    },
    forecast: {
      lowestBalance,
      lowestBalanceDate,
      criticalPayments: future.filter((payment) => payment.amount < 0 && priority(payment) === "A").length,
      overdueCritical: overdueCritical.length,
    },
  };
}
