// Период для Ozon-кокпита: и пресеты, и произвольный диапазон из календаря.
//
// Раньше экраны умели только «7 / 14 / 30 дней», и всегда от сегодня. Посмотреть
// прошлый месяц или конкретную неделю распродажи было нечем. Календарь снимает
// это ограничение, но период перестаёт быть числом — теперь это пара дат, а
// «сколько дней» из неё выводится, а не задаётся.
//
// Тот же словарь пресетов, что в РНП Wildberries: человек ходит между модулями,
// и «Месяц» обязан значить одно и то же в обоих.

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
export const ozonIso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/** Границы пресета — те же правила, что в РНП WB. */
export function ozonRangeFor(preset: OzonPeriodPreset, now = new Date()): { from: string; to: string } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);

  if (preset === "yesterday") {
    start.setDate(start.getDate() - 1);
    end.setDate(end.getDate() - 1);
  } else if (preset === "week") {
    start.setDate(start.getDate() - 6);
  } else if (preset === "two_weeks") {
    start.setDate(start.getDate() - 13);
  } else if (preset === "month") {
    start.setDate(1);
  } else if (preset === "quarter") {
    start.setDate(start.getDate() - 89);
  } else if (preset === "previous") {
    start.setMonth(start.getMonth() - 1, 1);
    end.setDate(0);
  }
  return { from: ozonIso(start), to: ozonIso(end) };
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
  const today = ozonIso(now);
  let from = isIso(rawFrom) ? rawFrom : null;
  let to = isIso(rawTo) ? rawTo : null;

  if (!from || !to) {
    const days = Math.min(OZON_MAX_PERIOD_DAYS, Math.max(1, Math.round(Number(fallbackDays) || 14)));
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
    from = ozonIso(start);
    to = today;
  }
  if (from > to) [from, to] = [to, from];
  if (to > today) to = today;
  if (from > to) from = to;

  const span = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY) + 1;
  if (span > OZON_MAX_PERIOD_DAYS) {
    from = new Date(Date.parse(`${to}T00:00:00Z`) - (OZON_MAX_PERIOD_DAYS - 1) * DAY).toISOString().slice(0, 10);
  }

  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY) + 1;
  return { from, to, days, endsToday: to === today };
}

/** Равный по длине период, стоящий вплотную перед этим — база для дельт. */
export function previousOzonPeriod(period: OzonPeriod): { from: string; to: string } {
  const to = new Date(Date.parse(`${period.from}T00:00:00Z`) - DAY);
  const from = new Date(to.getTime() - (period.days - 1) * DAY);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}
