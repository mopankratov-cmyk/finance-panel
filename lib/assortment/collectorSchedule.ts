/**
 * Что и когда реально собирает код — для честного экрана «Источники».
 *
 * Паспорт источника (assortment_sources.access_status) — это итог пробы этапа 0
 * («сайт отдаёт данные»), а не факт работы сборщика: Uniqlo числится «только
 * вручную» при том, что собирается готовым набором, ASOS и H&M — «доступ не
 * проверен», а Charles & Keith — «автосбор проверен», хотя обходчика у него нет.
 * Экран при этом красил «давно не запускался» по порогу в двое суток, а источники
 * с запуском раз-два в неделю краснели и в норме.
 *
 * Модуль чистый (без базы и сети): его импортирует и экран. Таблица ниже сверяется
 * с настоящим расписанием сборщиков тестом (tests/assortment-collector-schedule).
 */

/** Дни недели UTC (0 = воскресенье) — как в расписании сборщиков и кронов. */
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6] as const;

export const COLLECTION_WEEKDAYS: Readonly<Record<string, readonly number[]>> = {
  // Shopify-обход (крон assortment-crawl) — ежедневно.
  S014: EVERY_DAY, // Rains
  S024: EVERY_DAY, // Polène
  S026: EVERY_DAY, // Songmont
  S027: EVERY_DAY, // JW PEI
  // Bright Data: готовые наборы Zara и Uniqlo — по средам; сборщики ASOS и H&M — ср и сб.
  S001: [3],
  S003: [3],
  S046: [3, 6],
  S007: [3, 6],
  // Сайты РФ: свои дни у каждого магазина (RU_SHOPS.weekdaysUtc).
  S130: [1, 4], // Lime
  S131: [2, 5], // befree
  S132: [2, 5], // Love Republic
  S133: [3, 6], // ZARINA
  S134: [3, 6], // Sela
  S135: [0], // Pompa
  S136: [1, 4], // Askent
  S137: [2, 5], // Ushatava
  // Zalando (Bershka, Pull&Bear, Massimo Dutti) через загрузчик на mini.
  S138: [1, 4],
  S139: [1, 4],
  S140: [1, 4],
  // «Рынок РФ» (MPSTATS) — по понедельникам.
  S128: [1],
  S129: [1],
};

const DAY_MS = 24 * 3600 * 1000;

/** Запас на задержку прогона и одну осечку: сутки с половиной. */
const SLACK_DAYS = 1.5;

/** Порог по умолчанию — для источников вне таблицы (прежнее поведение экрана). */
const DEFAULT_STALE_DAYS = 2;

/** Самый длинный промежуток между запусками за неделю, в сутках (цикл через воскресенье). */
export function longestGapDays(weekdays: readonly number[]): number {
  const days = [...new Set(weekdays)].sort((a, b) => a - b);
  if (days.length === 0) return 7;
  if (days.length === 1) return 7;
  let max = 0;
  for (let i = 0; i < days.length; i++) {
    const next = i === days.length - 1 ? days[0] + 7 : days[i + 1];
    max = Math.max(max, next - days[i]);
  }
  return max;
}

/** Есть ли сборщик у источника в коде (по таблице расписаний). */
export function hasScheduledCollector(sourceId: string): boolean {
  return Object.prototype.hasOwnProperty.call(COLLECTION_WEEKDAYS, sourceId);
}

/** Через сколько миллисекунд молчания источник считаем «давно не запускался». */
export function staleAfterMs(sourceId: string): number {
  const weekdays = COLLECTION_WEEKDAYS[sourceId];
  if (!weekdays) return DEFAULT_STALE_DAYS * DAY_MS;
  return Math.max(DEFAULT_STALE_DAYS, longestGapDays(weekdays) + SLACK_DAYS) * DAY_MS;
}
