import { generateId } from "@/lib/format";
import type { Payment } from "@/lib/types";

export type Recurrence = "none" | "weekly" | "monthly" | "quarterly" | "yearly";

export interface RecurrenceRule {
  frequency: Recurrence;
  until: string;
}

// N-я дата серии считается от стартовой, а не от предыдущей: setMonth(+1) с
// 31 января давал 3 марта, дальше 3 апреля — и февраль выпадал. Число месяца
// держится за стартовое и прижимается к последнему дню короткого месяца.
export function nthRecurrenceDate(start: Date, frequency: Exclude<Recurrence, "none">, index: number): Date {
  if (frequency === "weekly") {
    const date = new Date(start);
    date.setDate(date.getDate() + 7 * index);
    return date;
  }
  const monthsStep = frequency === "monthly" ? 1 : frequency === "quarterly" ? 3 : 12;
  const year = start.getFullYear();
  const month = start.getMonth() + monthsStep * index;
  const lastDay = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(start.getDate(), lastDay));
}

const iso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export function expandRecurringPayment(data: Omit<Payment, "id">, rule?: RecurrenceRule): Payment[] {
  if (!rule || rule.frequency === "none" || !rule.until) return [{ id: generateId("pay"), ...data }];
  const seriesId = generateId("series");
  const result: Payment[] = [];
  const start = new Date(`${data.date}T00:00:00`);
  const end = new Date(`${rule.until}T00:00:00`);
  for (let index = 0; result.length < 240; index += 1) {
    const date = nthRecurrenceDate(start, rule.frequency, index);
    if (date > end) break;
    result.push({
      id: generateId("pay"),
      ...data,
      date: iso(date),
      status: "planned",
      comment: `${data.comment ? `${data.comment} · ` : ""}[series:${seriesId}] ${rule.frequency}, платёж ${index + 1}`,
    });
  }
  return result;
}
