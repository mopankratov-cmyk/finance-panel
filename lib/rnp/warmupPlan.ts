export const RNP_DEFAULT_TURNOVER_WINDOW_DAYS = 7;

export interface RnpWarmupScope {
  cabinetId: string | null;
  label: string;
}

export interface RnpWarmupPeriod {
  from: string;
  to: string;
}

export interface RnpWarmupTask extends RnpWarmupScope, RnpWarmupPeriod {
  turnoverWindowDays: number;
}

/**
 * Пользователь открывает отдельный кабинет за последние семь дней. Эти снимки
 * должны появиться раньше тяжёлой сводки «Все кабинеты» и месячных снимков.
 */
export function buildRnpWarmupBatches(
  scopes: readonly RnpWarmupScope[],
  periods: readonly RnpWarmupPeriod[],
  batchSize = 3,
): RnpWarmupTask[][] {
  if (!Number.isInteger(batchSize) || batchSize <= 0) throw new Error("Некорректный размер пачки прогрева РНП");
  const cabinetScopes = scopes.filter((scope) => scope.cabinetId !== null);
  const aggregateScopes = scopes.filter((scope) => scope.cabinetId === null);
  const batches: RnpWarmupTask[][] = [];
  const appendPeriod = (period: RnpWarmupPeriod, targets: readonly RnpWarmupScope[]) => {
    for (let offset = 0; offset < targets.length; offset += batchSize) {
      batches.push(targets.slice(offset, offset + batchSize).map((scope) => ({
        ...period,
        ...scope,
        turnoverWindowDays: RNP_DEFAULT_TURNOVER_WINDOW_DAYS,
      })));
    }
  };

  // Первый период — недельный дефолт интерфейса. Сначала он для всех кабинетов,
  // затем остальные периоды. Общая сводка всегда последняя: её таймаут больше
  // не лишает Retail Family и другие кабинеты собственного last-good снимка.
  for (const period of periods) appendPeriod(period, cabinetScopes);
  for (const period of periods) appendPeriod(period, aggregateScopes);
  return batches;
}
