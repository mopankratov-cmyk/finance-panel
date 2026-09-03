// Связь «план → факт ДДС». Метки ставятся на ПЛАН ([calendar-fact:<id>] —
// календарь, [paid-by:<id>] — сверка кредитов), поэтому у самого факта
// признака «уже использован» нет. Пока у каждого сопоставителя был свой
// локальный список занятых фактов, один банковский платёж мог закрыть и план
// календаря, и строку графика кредита. Здесь — общий ответ на вопрос «какие
// факты уже кем-то заняты».

import type { Payment } from "@/lib/types";

const FACT_LINK_PATTERNS = [/\[calendar-fact:([^\]]+)\]/g, /\[paid-by:([^\]]+)\]/g, /\[payroll-paid:([^\]]+)\]/g];

/** Метки, которые нельзя терять при пересборке строки графика из формы договора. */
const PRESERVED_MARKER_PATTERN = /\[(?:paid-by|calendar-fact|payroll-paid|priority|original-due|overdue-calendar-date):[^\]]+\]/g;

/** Id фактов, на которые ссылается комментарий одного платежа. */
export function linkedFactIds(comment: string | null | undefined): string[] {
  if (!comment) return [];
  const ids: string[] = [];
  for (const pattern of FACT_LINK_PATTERNS) {
    for (const match of comment.matchAll(pattern)) ids.push(match[1]);
  }
  return ids;
}

/**
 * Все факты, уже занятые каким-либо планом. `exceptPlanId` — план, чью
 * собственную связь учитывать не надо (он может её подтвердить заново).
 */
export function consumedFactIds(
  payments: readonly { id: Payment["id"]; comment?: string | null }[],
  exceptPlanId?: string,
): Set<string> {
  const consumed = new Set<string>();
  for (const payment of payments) {
    if (payment.id === exceptPlanId) continue;
    for (const id of linkedFactIds(payment.comment)) consumed.add(id);
  }
  return consumed;
}

export function hasFactLink(comment: string | null | undefined): boolean {
  return linkedFactIds(comment).length > 0;
}

/** Служебные метки существующей строки, которые надо перенести в пересобранную. */
export function preservedLoanMarkers(comment: string | null | undefined): string {
  return [...(comment ?? "").matchAll(PRESERVED_MARKER_PATTERN)].map((match) => match[0]).join(" ");
}
