/**
 * Сколько суток сдвигать часы (SHIFT_DAYS). Вынесено из shift-date.mts, чтобы правило читалось тестом без подмены Date в самом тесте.
 * Не задано — 60. Пусто, не число или не конечное — ошибка: молчаливый «ноль» (Number("") === 0) значил бы «сдвига нет», и проверка
 * «тесты не зависят от сегодня» прошла бы вхолостую, а NaN рушил бы Date.now() непонятной причиной.
 */
export const DEFAULT_SHIFT_DAYS = 60;

export function parseShiftDays(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_SHIFT_DAYS;
  const days = raw.trim() === "" ? Number.NaN : Number(raw);
  if (!Number.isFinite(days)) {
    throw new Error(`SHIFT_DAYS=${JSON.stringify(raw)}: нужно конечное число суток (например 60); не задавайте переменную — будет ${DEFAULT_SHIFT_DAYS}`);
  }
  return days;
}
