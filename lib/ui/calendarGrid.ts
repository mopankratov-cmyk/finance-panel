// Календарная сетка для выбора периода: чистые функции без DOM и таймзон
// браузера. Все даты — ISO-строки «ГГГГ-ММ-ДД» в московском календаре
// (панель везде считает дни по Москве).

export interface CalendarCell {
  iso: string;
  day: number;
  /** Принадлежит показываемому месяцу (соседние дни гасим). */
  currentMonth: boolean;
}

export interface CalendarMonth {
  year: number;
  /** 1–12 */
  month: number;
  title: string;
  /** Недели по 7 дней, начало недели — понедельник. */
  weeks: CalendarCell[][];
}

const MONTH_TITLES = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

export const WEEKDAY_TITLES = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"] as const;

export function isoOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function parseIso(iso: string): Date | null {
  const parsed = new Date(`${iso}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Сегодня в московском календаре. */
export function moscowToday(nowMs = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow" }).format(new Date(nowMs));
}

export function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const zeroBased = year * 12 + (month - 1) + delta;
  return { year: Math.floor(zeroBased / 12), month: (zeroBased % 12) + 1 };
}

/** Месяц сеткой недель пн–вс с добивкой соседними днями. */
export function buildCalendarMonth(year: number, month: number): CalendarMonth {
  const first = new Date(Date.UTC(year, month - 1, 1));
  // getUTCDay(): вс=0 → сдвигаем к понедельнику.
  const leading = (first.getUTCDay() + 6) % 7;
  const cursor = new Date(first);
  cursor.setUTCDate(cursor.getUTCDate() - leading);

  const weeks: CalendarCell[][] = [];
  for (let week = 0; week < 6; week++) {
    const row: CalendarCell[] = [];
    for (let day = 0; day < 7; day++) {
      row.push({
        iso: isoOf(cursor),
        day: cursor.getUTCDate(),
        currentMonth: cursor.getUTCMonth() === month - 1 && cursor.getUTCFullYear() === year,
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    weeks.push(row);
  }
  // Хвостовые недели без единого своего дня не рисуем — сетка не «висит» пустой.
  const trimmed = weeks.filter((week) => week.some((cell) => cell.currentMonth));

  return { year, month, title: `${MONTH_TITLES[month - 1]} ${year}`, weeks: trimmed };
}

/** Пара соседних месяцев — левый показывает якорь. */
export function calendarPair(year: number, month: number): [CalendarMonth, CalendarMonth] {
  const next = addMonths(year, month, 1);
  return [buildCalendarMonth(year, month), buildCalendarMonth(next.year, next.month)];
}

/** Клик по дню: первый задаёт начало, второй — конец (порядок не важен). */
export function applyDayClick(
  draft: { from: string; to: string | null },
  iso: string,
): { from: string; to: string | null } {
  if (draft.to === null) {
    return iso < draft.from ? { from: iso, to: draft.from } : { from: draft.from, to: iso };
  }
  return { from: iso, to: null };
}

export function isWithinRange(iso: string, from: string, to: string | null): boolean {
  if (!to) return iso === from;
  return iso >= from && iso <= to;
}

/** Якорный месяц поповера: показываем месяц начала периода. */
export function anchorMonthFor(iso: string, fallbackIso: string): { year: number; month: number } {
  const date = parseIso(iso) ?? parseIso(fallbackIso) ?? new Date();
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

/** Подпись периода «12.08.26 – 18.08.26». */
export function formatRangeLabel(from: string, to: string): string {
  const short = (iso: string) => {
    const [year, month, day] = iso.split("-");
    return year && month && day ? `${day}.${month}.${year.slice(2)}` : iso;
  };
  return `${short(from)} – ${short(to)}`;
}
