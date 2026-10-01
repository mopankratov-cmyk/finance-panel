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
  if (/(налог|ндфл|усн|фнс|зарплат|(?:^|\s)зп(?:\s|$)|аванс сотруд|кредит|процент|погашен|обязатель|тамож|аренд)/.test(text)) return "A";
  if (/(товар|закуп|поставщик|логист|достав|склад|хранен|комисси|маркетплейс|рко|банк|сервис|подряд)/.test(text)) return "B";
  return "C";
}

export function getPaymentPriority(payment: Pick<Payment, "comment" | "category" | "name">): PaymentPriority {
  const match = payment.comment?.match(/\[priority:([ABC])\]/i);
  const explicit = match?.[1]?.toUpperCase() as PaymentPriority | undefined;
  const suggested = suggestPaymentPriority(payment.category, payment.name);

  // Критичные обязательства нельзя случайно оставить переносимыми. Такое
  // происходило у строк, созданных с приоритетом C до выбора статьи: после
  // выбора процентов, кредита, налогов или зарплаты старый маркер побеждал
  // корректную классификацию статьи.
  if (suggested === "A") return "A";
  return explicit ?? suggested;
}

export function plannedExpensePrioritySummary(payments: readonly Pick<Payment, "status" | "amount" | "date" | "comment" | "category" | "name">[], today: string) {
  return (["A", "B", "C"] as PaymentPriority[]).map((priority) => {
    const matching = payments.filter((payment) =>
      payment.status === "planned"
      && payment.amount < 0
      && getPaymentPriority(payment) === priority,
    );
    return {
      priority,
      count: matching.length,
      plannedExpense: matching.reduce((sum, payment) => sum - payment.amount, 0),
      overdue: matching.filter((payment) => payment.date < today).length,
    };
  });
}

export function cleanPaymentComment(comment?: string): string {
  return (comment ?? "").replace(PRIORITY_MARKER, " ").replace(/\s{2,}/g, " ").trim();
}

export function displayPaymentComment(comment?: string): string {
  const source = comment ?? "";
  const contract = source.match(/\[contract:([^\]]+)\]/i)?.[1]?.trim();
  const plain = editablePaymentComment(source);
  return [plain, contract ? `Договор: ${contract}` : ""].filter(Boolean).join(" · ");
}

export function displayPaymentLabel(payment: Pick<Payment, "name" | "comment" | "counterparty" | "category">): string {
  return payment.name || displayPaymentComment(payment.comment) || payment.counterparty || payment.category || "Без комментария";
}

export function editablePaymentComment(comment?: string): string {
  return (comment ?? "").replace(/\[[^\]]+\]/g, " ").replace(/\s{2,}/g, " ").trim();
}

export function setPaymentPriorityComment(comment: string | undefined, priority: PaymentPriority): string {
  const clean = cleanPaymentComment(comment);
  return `${clean}${clean ? " " : ""}[priority:${priority}]`;
}

export function priorityRank(payment: Pick<Payment, "comment" | "category" | "name">): number {
  return { A: 0, B: 1, C: 2 }[getPaymentPriority(payment)];
}

export function chronologicalPaymentOrder(
  left: Pick<Payment, "date" | "amount" | "comment" | "category" | "name">,
  right: Pick<Payment, "date" | "amount" | "comment" | "category" | "name">,
): number {
  return right.date.localeCompare(left.date)
    || priorityRank(left) - priorityRank(right)
    || Math.abs(right.amount) - Math.abs(left.amount)
    || left.name.localeCompare(right.name, "ru");
}
