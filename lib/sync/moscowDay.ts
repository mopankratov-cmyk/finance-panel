/**
 * Календарь синхронизаций WB — московский, а не UTC.
 *
 * Синки строили окно через `new Date().toISOString()`: с 21:00 до полуночи по
 * Москве UTC-дата ещё вчерашняя, и «сегодня» в окне не появлялось. Для рекламы
 * это значило, что вечерний прогон собирал данные по вчерашний день
 * включительно, а сегодняшний расход подтягивался только на следующие сутки —
 * при том, что WB считает день по Москве и цифра уже была доступна.
 */

const MOSCOW_FORMAT = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow" });
const DAY_MS = 86_400_000;

/** Сегодняшняя дата в московском календаре, ГГГГ-ММ-ДД. */
export function moscowToday(now: Date | number = new Date()): string {
  return MOSCOW_FORMAT.format(typeof now === "number" ? new Date(now) : now);
}

/** Сдвиг «голой» даты на дни — без часовых поясов и переходов. */
export function shiftIsoDay(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}
