import type { Payment } from "@/lib/types";

export interface PlanFactMatch {
  planned: Payment;
  fact: Payment;
  score: number;
}

const dayDistance = (a: string, b: string) =>
  Math.abs(new Date(`${a}T00:00:00`).getTime() - new Date(`${b}T00:00:00`).getTime()) / 86_400_000;

const clean = (value: string) => value.toLowerCase().replace(/[^а-яa-z0-9]+/gi, " ").trim();

export function matchPlannedToFacts(payments: Payment[]): PlanFactMatch[] {
  const planned = payments.filter((payment) => payment.status === "planned" && isMarketplaceOrLoanIncome(payment));
  const facts = payments.filter((payment) => payment.status === "done" && isMarketplaceOrLoanIncome(payment));
  const usedFacts = new Set<string>();
  const matches: PlanFactMatch[] = [];

  for (const plan of planned) {
    const candidates = facts
      .filter((fact) => !usedFacts.has(fact.id))
      .map((fact) => {
        const days = dayDistance(plan.date, fact.date);
        if (days > 7) return null;
        const amountDifference = Math.abs(plan.amount - fact.amount) / Math.max(plan.amount, fact.amount, 1);
        let score = 45 - days * 4;
        if (plan.accountId === fact.accountId) score += 20;
        if (clean(plan.counterparty) && clean(plan.counterparty) === clean(fact.counterparty)) score += 15;
        if (clean(plan.category) === clean(fact.category)) score += 10;
        if (amountDifference <= 0.01) score += 20;
        else if (amountDifference <= 0.05) score += 15;
        else if (amountDifference <= 0.15) score += 8;
        else if (amountDifference <= 0.3) score += 3;
        return { fact, score };
      })
      .filter((candidate): candidate is { fact: Payment; score: number } => candidate !== null)
      .sort((a, b) => b.score - a.score);

    if (candidates[0] && candidates[0].score >= 55) {
      usedFacts.add(candidates[0].fact.id);
      matches.push({ planned: plan, fact: candidates[0].fact, score: Math.min(100, candidates[0].score) });
    }
  }
  return matches;
}

export function calendarPaymentsWithoutMatchedPlans(payments: Payment[], matches: PlanFactMatch[]) {
  const matchedPlanIds = new Set(matches.map((match) => match.planned.id));
  return payments.filter((payment) => !matchedPlanIds.has(payment.id));
}

const cashText = (payment: Payment) =>
  `${payment.category} ${payment.name} ${payment.counterparty}`.toLowerCase();

export function isTechnicalTransfer(payment: Payment) {
  const text = cashText(payment);
  return (
    text.includes("перевод между счет") ||
    text.includes("перевод между счёт") ||
    text.includes("техническ") ||
    text.includes("внутренний перевод")
  );
}

export function isMarketplaceOrLoanIncome(payment: Payment) {
  if (payment.amount <= 0 || isTechnicalTransfer(payment)) return false;
  const text = payment.category.toLowerCase().replace(/ё/g, "е");
  return (
    (text.includes("продаж") && (text.includes("мп") || text.includes("маркетплейс"))) ||
    text.includes("wildberries") ||
    text.includes("ozon") ||
    text.includes("вайлдберриз") ||
    text.includes("получение кредит") ||
    text.includes("получение займ") ||
    text.includes("получен кредит") ||
    text.includes("получен займ")
  );
}

export function isCalendarCashFlow(payment: Payment) {
  if (payment.status === "cancelled" || isTechnicalTransfer(payment)) return false;
  return payment.amount < 0 || isMarketplaceOrLoanIncome(payment);
}
