import { consumedFactIds } from "@/lib/finance/factLinks";
import type { Payment } from "@/lib/types";

export interface PlanFactMatch {
  planned: Payment;
  fact: Payment;
  score: number;
  source: "automatic" | "confirmed";
}

export interface PlanFactMatchingResult {
  matched: PlanFactMatch[];
  review: PlanFactMatch[];
}

const dayDistance = (a: string, b: string) =>
  Math.abs(new Date(`${a}T00:00:00`).getTime() - new Date(`${b}T00:00:00`).getTime()) / 86_400_000;

const clean = (value: string) => value.toLowerCase().replace(/[^а-яa-z0-9]+/gi, " ").trim();
const PURPOSE_STOP_WORDS = new Set(["оплата", "платеж", "поступление", "перечисление", "сумма", "без", "ндс"]);

function purposeSimilarity(left: Payment, right: Payment) {
  const tokens = (payment: Payment) => new Set(clean(`${payment.name} ${payment.comment ?? ""}`)
    .split(" ")
    .filter((word) => word.length >= 4 && !PURPOSE_STOP_WORDS.has(word)));
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  if (!leftTokens.size || !rightTokens.size) return 0;
  const overlap = [...leftTokens].filter((word) => rightTokens.has(word)).length;
  return overlap / Math.max(1, Math.min(leftTokens.size, rightTokens.size));
}

const linkedFactId = (payment: Payment) => payment.comment?.match(/\[calendar-fact:([^\]]+)\]/)?.[1] ?? null;

export function withCalendarFactLink(payment: Payment, factId: string): Payment {
  const withoutOldLink = (payment.comment ?? "").replace(/\s*\[calendar-fact:[^\]]+\]/g, "").trim();
  return { ...payment, status: "cancelled", comment: `${withoutOldLink}${withoutOldLink ? " " : ""}[calendar-fact:${factId}]` };
}

export function findPlanFactMatches(
  payments: Payment[],
  companyByPayment: Map<string, string | null> = new Map(),
): PlanFactMatchingResult {
  const planned = payments.filter((payment) => (payment.status === "planned" && isCalendarCashFlow(payment)) || Boolean(linkedFactId(payment)));
  const facts = payments.filter((payment) => payment.status === "done" && isCalendarCashFlow(payment));
  // Факт, уже закрывший строку графика кредита или другой план, второй раз не предлагается.
  const consumed = consumedFactIds(payments);
  const usedFacts = new Set<string>();
  const matched: PlanFactMatch[] = [];
  const review: PlanFactMatch[] = [];

  for (const plan of planned) {
    const persistedFactId = linkedFactId(plan);
    const persistedFact = persistedFactId ? facts.find((fact) => fact.id === persistedFactId) : null;
    if (persistedFact && !usedFacts.has(persistedFact.id) && Math.sign(persistedFact.amount) === Math.sign(plan.amount)) {
      usedFacts.add(persistedFact.id);
      matched.push({ planned: plan, fact: persistedFact, score: 100, source: "confirmed" });
      continue;
    }
    const candidates = facts
      .filter((fact) => !usedFacts.has(fact.id) && (!consumed.has(fact.id) || persistedFactId === fact.id))
      .map((fact) => {
        if (Math.sign(plan.amount) !== Math.sign(fact.amount)) return null;
        const planCompany = companyByPayment.get(plan.id) ?? null;
        const factCompany = companyByPayment.get(fact.id) ?? null;
        if (planCompany && factCompany && planCompany !== factCompany) return null;
        const days = dayDistance(plan.date, fact.date);
        if (days > 7) return null;
        const amountDifference = Math.abs(plan.amount - fact.amount) / Math.max(Math.abs(plan.amount), Math.abs(fact.amount), 1);
        if (amountDifference > 0.3) return null;
        let score = 35 - days * 4;
        if (planCompany && planCompany === factCompany) score += 25;
        if (plan.accountId === fact.accountId) score += 20;
        if (clean(plan.counterparty) && clean(plan.counterparty) === clean(fact.counterparty)) score += 15;
        if (clean(plan.category) === clean(fact.category)) score += 10;
        const purposeScore = purposeSimilarity(plan, fact);
        if (purposeScore >= 0.75) score += 20;
        else if (purposeScore >= 0.4) score += 10;
        if (amountDifference <= 0.01) score += 20;
        else if (amountDifference <= 0.05) score += 15;
        else if (amountDifference <= 0.15) score += 8;
        else if (amountDifference <= 0.3) score += 3;
        return { fact, score };
      })
      .filter((candidate): candidate is { fact: Payment; score: number } => candidate !== null)
      .sort((a, b) => b.score - a.score);

    const best = candidates[0];
    const gap = best ? best.score - (candidates[1]?.score ?? 0) : 0;
    // Автоматически (без подтверждения) план закрывается только фактом с той же
    // суммой: совпавшие компания/кошелёк/контрагент/статья набирали 80+ баллов и
    // при расхождении до 30% — план на 100 000 гасился фактом на 70 000.
    const exactAmount = best ? Math.abs(plan.amount - best.fact.amount) <= Math.max(0.01, Math.abs(plan.amount) * 0.01) : false;
    if (best && best.score >= 80 && gap >= 10 && exactAmount) {
      usedFacts.add(best.fact.id);
      matched.push({ planned: plan, fact: best.fact, score: Math.min(100, best.score), source: "automatic" });
    } else if (best && best.score >= 55) {
      review.push({ planned: plan, fact: best.fact, score: Math.min(100, best.score), source: "automatic" });
    }
  }
  return { matched, review };
}

export function matchPlannedToFacts(payments: Payment[], companyByPayment: Map<string, string | null> = new Map()): PlanFactMatch[] {
  return findPlanFactMatches(payments, companyByPayment).matched;
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

// Решение владельца 04.09.2026: в календаре и прогнозе остатка видны ВСЕ
// поступления, кроме переводов между своими счетами. Раньше доходы фильтровались
// (только МП и кредиты), а расходы считались все — прогноз был занижен.
export function isCalendarCashFlow(payment: Payment) {
  if (payment.status === "cancelled" || isTechnicalTransfer(payment)) return false;
  return payment.amount !== 0;
}
