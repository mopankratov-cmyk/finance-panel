// Период для Ozon-кокпита: и пресеты, и произвольный диапазон из календаря.
//
// Раньше экраны умели только «7 / 14 / 30 дней», и всегда от сегодня. Посмотреть
// прошлый месяц или конкретную неделю распродажи было нечем. Календарь снимает
// это ограничение, но период перестаёт быть числом — теперь это пара дат, а
// «сколько дней» из неё выводится, а не задаётся.
//
// Тот же словарь пресетов, что в РНП Wildberries: человек ходит между модулями,
// и «Месяц» обязан значить одно и то же в обоих.
//
// ВСЁ считается по Москве — и на сервере, и в браузере. Раньше «сегодня» на
// сервере было днём по UTC, а в браузере — днём по часам пользователя: с 00:00
// до 03:00 МСК сервер отрезал у периода сегодняшний день, «Сегодня» показывало
// вчера, а прогретые снимки переставали совпадать с тем, что просит интерфейс.

export type OzonPeriodPreset =
  | "today" | "yesterday" | "week" | "two_weeks" | "month" | "quarter" | "previous" | "custom";

export interface OzonPeriod {
  from: string;
  to: string;
  /** Длина периода в днях, включая обе границы. */
  days: number;
  /** Период кончается сегодня — только для такого годится кэш, привязанный к «последним N дням». */
  endsToday: boolean;
}

export const OZON_PERIOD_PRESETS = [
  { value: "today", label: "Сегодня" },
  { value: "yesterday", label: "Вчера" },
  { value: "week", label: "Неделя" },
  { value: "two_weeks", label: "2 недели" },
  { value: "month", label: "Месяц" },
  { value: "quarter", label: "Квартал" },
  { value: "previous", label: "Пред. месяц" },
] as const;

/** Дальше квартала не пускаем: аналитика Ozon отдаётся построчно «SKU × день»,
 *  и полгода ассортимента не успеют доехать за время запроса. */
export const OZON_MAX_PERIOD_DAYS = 92;

const DAY = 86_400_000;

/** Часовой пояс кабинетов и отчётов Ozon. */
export const OZON_TIMEZONE = "Europe/Moscow";
const moscowFormat = new Intl.DateTimeFormat("en-CA", { timeZone: OZON_TIMEZONE });

/** Сегодняшняя дата по Москве — одинаково на сервере и в браузере. */
export function ozonToday(now: Date | number = new Date()): string {
  return moscowFormat.format(typeof now === "number" ? new Date(now) : now);
}

export const ozonIso = (date: Date) => ozonToday(date);

/** Календарная арифметика над «голой» датой, без часовых поясов. */
const dayMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const isoOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const shiftDays = (iso: string, days: number) => isoOf(dayMs(iso) + days * DAY);

/** Границы пресета — те же правила, что в РНП WB. */
export function ozonRangeFor(preset: OzonPeriodPreset, now = new Date()): { from: string; to: string } {
  const today = ozonToday(now);
  let from = today;
  let to = today;

  if (preset === "yesterday") {
    from = shiftDays(today, -1);
    to = from;
  } else if (preset === "week") {
    from = shiftDays(today, -6);
  } else if (preset === "two_weeks") {
    from = shiftDays(today, -13);
  } else if (preset === "month") {
    from = `${today.slice(0, 7)}-01`;
  } else if (preset === "quarter") {
    from = shiftDays(today, -89);
  } else if (preset === "previous") {
    const firstOfThisMonth = `${today.slice(0, 7)}-01`;
    to = shiftDays(firstOfThisMonth, -1);
    from = `${to.slice(0, 7)}-01`;
  }
  return { from, to };
}

const isIso = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

/**
 * Привести запрошенный период к рабочему: перевёрнутые границы разворачиваем,
 * будущее отсекаем, слишком длинный период укорачиваем с начала — правая
 * граница человеку важнее, он смотрит «до какого числа».
 */
export function resolveOzonPeriod(
  rawFrom: unknown,
  rawTo: unknown,
  fallbackDays = 14,
  now = new Date(),
): OzonPeriod {
  const today = ozonToday(now);
  let from = isIso(rawFrom) ? rawFrom : null;
  let to = isIso(rawTo) ? rawTo : null;

  if (!from || !to) {
    const days = Math.min(OZON_MAX_PERIOD_DAYS, Math.max(1, Math.round(Number(fallbackDays) || 14)));
    from = shiftDays(today, -(days - 1));
    to = today;
  }
  if (from > to) [from, to] = [to, from];
  if (to > today) to = today;
  if (from > to) from = to;

  const span = Math.round((dayMs(to) - dayMs(from)) / DAY) + 1;
  if (span > OZON_MAX_PERIOD_DAYS) from = shiftDays(to, -(OZON_MAX_PERIOD_DAYS - 1));

  const days = Math.round((dayMs(to) - dayMs(from)) / DAY) + 1;
  return { from, to, days, endsToday: to === today };
}

/** Равный по длине период, стоящий вплотную перед этим — база для дельт. */
export function previousOzonPeriod(period: OzonPeriod): { from: string; to: string } {
  const to = shiftDays(period.from, -1);
  return { from: shiftDays(to, -(period.days - 1)), to };
}
