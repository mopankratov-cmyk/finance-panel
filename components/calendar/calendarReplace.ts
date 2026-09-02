// Замена части планового календаря из файла: какие старые планы удалять.
// Раньше удаление шло по всем месяцам сразу — импорт октября сносил планы
// ноября и декабря, а число в подтверждении считалось по другой выборке
// (только «без компании»), чем само удаление. Здесь одна функция для обоих.

import type { Payment } from "@/lib/types";

export type CalendarReplaceScope = "expenses" | "income" | "all";

/** Месяцы «YYYY-MM», которые есть в импортируемом файле. */
export function importedMonths(payments: readonly Pick<Payment, "date">[]): Set<string> {
  return new Set(payments.map((payment) => payment.date.slice(0, 7)).filter((month) => /^\d{4}-\d{2}$/.test(month)));
}

export function matchesReplaceScope(payment: Pick<Payment, "amount">, scope: CalendarReplaceScope): boolean {
  return scope === "all" || (scope === "income" ? payment.amount > 0 : payment.amount < 0);
}

/**
 * Плановые строки, которые заменит импорт: та же компания (или её отсутствие),
 * тот же тип потока и ТОЛЬКО те месяцы, что есть в файле. Пустой набор месяцев —
 * ничего не удаляем.
 */
export function plannedPaymentsToReplace(
  payments: readonly Payment[],
  companyByPayment: ReadonlyMap<string, string | null>,
  options: { companyId: string | null; scope: CalendarReplaceScope; months: ReadonlySet<string> },
): Payment[] {
  if (options.months.size === 0) return [];
  return payments.filter((payment) => {
    if (payment.status !== "planned" || !matchesReplaceScope(payment, options.scope)) return false;
    const linked = companyByPayment.get(payment.id) ?? null;
    if (options.companyId ? linked !== options.companyId : linked) return false;
    return options.months.has(payment.date.slice(0, 7));
  });
}
