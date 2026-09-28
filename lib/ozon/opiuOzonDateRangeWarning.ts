/**
 * Синк начислений (app/api/sync/ozon-accruals/route.ts, BACKFILL_DAYS) хранит
 * историю не глубже 75 дней, а расход на рекламу (ozon_ad_daily) заведомо
 * короче квартала. Период до этой границы даёт реальные, но пустые «Продажи»
 * при ненулевой «Рекламе» — «К выплате» выглядит большим отрицательным
 * числом без единой подсказки, откуда это (finding I7 в финальном ревью).
 * Дублирует константу синка намеренно — так проще, чем тянуть значение через
 * границу двух отдельных route.ts.
 */
const ACCRUAL_BACKFILL_DAYS = 75;

export function buildOzonOpiuDateRangeWarning(dateFrom: string, today: Date): string | null {
  const floor = new Date(today.getTime() - ACCRUAL_BACKFILL_DAYS * 86_400_000).toISOString().slice(0, 10);
  if (dateFrom >= floor) return null;
  return `Начисления Ozon хранятся не глубже ${ACCRUAL_BACKFILL_DAYS} дней — данные до ${floor} могут быть неполными или отсутствовать.`;
}
