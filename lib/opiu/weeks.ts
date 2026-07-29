import { addDays } from "@/lib/analytics/format";

export interface MonthWeek {
  weekStart: string;
  rangeFrom: string;
  rangeTo: string;
  label: string;
}

function toLocalISODate(d: Date): string {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

function formatShort(d: Date): string {
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

/** Недели пн–вс, пересекающиеся с календарным месяцем */
export function weeksInMonth(year: number, monthIndex: number): MonthWeek[] {
  const monthStart = new Date(year, monthIndex, 1);
  const monthEnd = new Date(year, monthIndex + 1, 0);

  const cursor = new Date(monthStart);
  const mondayOffset = (cursor.getDay() + 6) % 7;
  cursor.setDate(cursor.getDate() - mondayOffset);

  const weeks: MonthWeek[] = [];

  while (cursor <= monthEnd) {
    const weekStart = new Date(cursor);
    const weekEnd = addDays(weekStart, 6);
    weeks.push({
      weekStart: toLocalISODate(weekStart),
      rangeFrom: toLocalISODate(weekStart < monthStart ? monthStart : weekStart),
      rangeTo: toLocalISODate(weekEnd > monthEnd ? monthEnd : weekEnd),
      label: `${formatShort(weekStart)} – ${formatShort(weekEnd)}`,
    });

    cursor.setDate(cursor.getDate() + 7);
  }

  return weeks;
}

export function parseMonthParam(month: string): { year: number; monthIndex: number } {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) {
    const now = new Date();
    return { year: now.getFullYear(), monthIndex: now.getMonth() };
  }
  return { year: y, monthIndex: m - 1 };
}

export function currentMonthParam(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}
