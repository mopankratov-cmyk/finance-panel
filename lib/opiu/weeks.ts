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

/** Понедельник недели, в которую попадает переданная дата. */
export function mondayOfWeek(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  const mondayOffset = (d.getDay() + 6) % 7;
  return toLocalISODate(addDays(d, -mondayOffset));
}

/**
 * Скользящее окно из `count` полных недель пн–вс, заканчивающееся неделей,
 * в которую попадает `endDate` (эта неделя — последний/самый свежий столбец).
 * Всегда полные недели без обрезки по границе календарного месяца и без
 * пустых недель, которые ещё не наступили (см. обсуждение — ОПиУ раньше
 * резал недели по границе месяца, из-за чего динамику в 4 недели нельзя
 * было увидеть на одном экране).
 */
export function weeksEndingAt(endDate: string, count: number): MonthWeek[] {
  const lastWeekStart = new Date(`${mondayOfWeek(endDate)}T00:00:00`);

  const weeks: MonthWeek[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const weekStart = addDays(lastWeekStart, -7 * i);
    const weekEnd = addDays(weekStart, 6);
    weeks.push({
      weekStart: toLocalISODate(weekStart),
      rangeFrom: toLocalISODate(weekStart),
      rangeTo: toLocalISODate(weekEnd),
      label: `${formatShort(weekStart)} – ${formatShort(weekEnd)}`,
    });
  }
  return weeks;
}

/** Понедельник текущей недели — верхняя граница для стрелки "вперёд" в скользящем окне. */
export function currentWeekStartParam(): string {
  return mondayOfWeek(todayParam());
}

export function todayParam(): string {
  return toLocalISODate(new Date());
}

/** Один произвольный период (не привязан к неделям/месяцу) — для выбора диапазона дат в календаре. */
export function periodFromRange(dateFrom: string, dateTo: string): MonthWeek {
  const from = new Date(`${dateFrom}T00:00:00`);
  const to = new Date(`${dateTo}T00:00:00`);
  const currentYear = new Date().getFullYear();
  const sameYear = from.getFullYear() === to.getFullYear();
  const showYear = !sameYear || from.getFullYear() !== currentYear;
  const fromLabel = formatShort(from);
  const toLabel = showYear
    ? `${formatShort(to)} ${to.getFullYear()}`
    : formatShort(to);
  return {
    weekStart: dateFrom,
    rangeFrom: dateFrom,
    rangeTo: dateTo,
    label: `${fromLabel} – ${toLabel}`,
  };
}

export function isValidDateParam(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00`).getTime());
}
