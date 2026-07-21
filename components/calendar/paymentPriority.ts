import type { Payment } from "@/lib/types";

export type PaymentPriority = "A" | "B" | "C";
export type PaymentPriorityScope = "all" | PaymentPriority;

const PRIORITY_MARKER = /\s*\[priority:([ABC])\]\s*/gi;

export const PRIORITY_META: Record<PaymentPriority, { label: string; description: string; badge: string }> = {
  A: {
    label: "A — критичные",
    description: "Нельзя переносить: налоги, зарплата, кредиты и обязательные платежи",
    badge: "border-rose-200 bg-rose-100 text-rose-800",
  },
  B: {
    label: "B — важные",
    description: "Нужны для текущей работы бизнеса",
    badge: "border-amber-200 bg-amber-100 text-amber-800",
  },
  C: {
    label: "C — переносимые",
    description: "Можно отложить при нехватке денег",
    badge: "border-sky-200 bg-sky-100 text-sky-800",
  },
};

export function suggestPaymentPriority(category = "", name = ""): PaymentPriority {
  const text = `${category} ${name}`.toLowerCase().replace(/ё/g, "е");
  if (/(налог|ндфл|усн|фнс|зарплат|аванс сотруд|кредит|процент|погашен|обязатель|тамож|аренд)/.test(text)) return "A";
  if (/(товар|закуп|поставщик|логист|достав|склад|хранен|комисси|маркетплейс|рко|банк|сервис|подряд)/.test(text)) return "B";
  return "C";
}

export function getPaymentPriority(payment: Pick<Payment, "comment" | "category" | "name">): PaymentPriority {
  const match = payment.comment?.match(/\[priority:([ABC])\]/i);
  return (match?.[1]?.toUpperCase() as PaymentPriority | undefined) ??
    suggestPaymentPriority(payment.category, payment.name);
}

export function cleanPaymentComment(comment?: string): string {
  return (comment ?? "").replace(PRIORITY_MARKER, " ").replace(/\s{2,}/g, " ").trim();
}

export function setPaymentPriorityComment(comment: string | undefined, priority: PaymentPriority): string {
  const clean = cleanPaymentComment(comment);
  return `${clean}${clean ? " " : ""}[priority:${priority}]`;
}

export function priorityRank(payment: Pick<Payment, "comment" | "category" | "name">): number {
  return { A: 0, B: 1, C: 2 }[getPaymentPriority(payment)];
}
