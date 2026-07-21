import { generateId } from "@/lib/format";
import type { Payment } from "@/lib/types";

export type Recurrence = "none" | "weekly" | "monthly" | "quarterly" | "yearly";

export interface RecurrenceRule {
  frequency: Recurrence;
  until: string;
}

function nextDate(current: Date, frequency: Exclude<Recurrence, "none">) {
  const next = new Date(current);
  if (frequency === "weekly") next.setDate(next.getDate() + 7);
  if (frequency === "monthly") next.setMonth(next.getMonth() + 1);
  if (frequency === "quarterly") next.setMonth(next.getMonth() + 3);
  if (frequency === "yearly") next.setFullYear(next.getFullYear() + 1);
  return next;
}

const iso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export function expandRecurringPayment(data: Omit<Payment, "id">, rule?: RecurrenceRule): Payment[] {
  if (!rule || rule.frequency === "none" || !rule.until) return [{ id: generateId("pay"), ...data }];
  const seriesId = generateId("series");
  const result: Payment[] = [];
  let date = new Date(`${data.date}T00:00:00`);
  const end = new Date(`${rule.until}T00:00:00`);
  let index = 1;
  while (date <= end && result.length < 240) {
    result.push({
      id: generateId("pay"),
      ...data,
      date: iso(date),
      status: "planned",
      comment: `${data.comment ? `${data.comment} · ` : ""}[series:${seriesId}] ${rule.frequency}, платёж ${index}`,
    });
    date = nextDate(date, rule.frequency);
    index += 1;
  }
  return result;
}
