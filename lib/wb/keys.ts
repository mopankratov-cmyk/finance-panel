import { addDays, toISODate } from "@/lib/analytics/format";

export const SALES_LIMIT = "100000";

/** Последние 7 календарных дней (включая сегодня) */
export function sevenDayRange(): { dateFrom: string; dateTo: string } {
  const to = new Date();
  const from = addDays(to, -6);
  return { dateFrom: toISODate(from), dateTo: toISODate(to) };
}

export function stocksDateFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return toISODate(d);
}
