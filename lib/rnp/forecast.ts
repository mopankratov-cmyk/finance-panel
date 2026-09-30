export type RnpMetricStatus = "ready" | "partial" | "unavailable";

export interface RnpMetricForecast {
  value: number;
  low: number;
  high: number;
  confidencePct: number;
  coveragePct: number;
  observedDays: number;
  futureDays: number;
  method: string;
  /** Прогноз опирается на неполный факт незакрытого дня как на нижнюю границу. */
  partialFloor?: boolean;
}

export const PARTIAL_FLOOR_METHOD_NOTE = "; незакрытый день — не ниже уже пришедшего";

const WEEKDAY_PRIOR_DAYS = 2;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function finite(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value);
}

function weekday(isoDate: string) {
  return new Date(`${isoDate}T00:00:00.000Z`).getUTCDay();
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

export function currentMoscowDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

export function hideFutureValues(days: string[], values: (number | null)[], asOf: string) {
  return days.map((day, index) => day > asOf ? null : values[index] ?? null);
}

export function coverageForPeriod(days: string[], values: (number | null)[], asOf: string) {
  const eligible = days.reduce((count, day) => count + (day <= asOf ? 1 : 0), 0);
  if (eligible === 0) return 0;
  const known = days.reduce(
    (count, day, index) => count + (day <= asOf && finite(values[index]) ? 1 : 0),
    0,
  );
  return Math.round((known / eligible) * 1_000) / 10;
}

export function statusForCoverage(coveragePct: number): RnpMetricStatus {
  if (coveragePct <= 0) return "unavailable";
  if (coveragePct < 100) return "partial";
  return "ready";
}

export interface AdditiveForecastOptions {
  /**
   * Значение за день после `asOf` — неполный факт этого дня, а не пустота:
   * заказы из WB Статистики до прихода воронки. Прогноз дня не опускается ниже
   * уже пришедшего — иначе 71 заказ за сегодня заменялся проекцией в 49, и
   * прогноз периода выходил меньше показанного факта.
   */
  partialAfterAsOf?: boolean;
}

export function forecastAdditiveMetric(
  days: string[],
  values: (number | null)[],
  asOf: string,
  options: AdditiveForecastOptions = {},
): RnpMetricForecast | null {
  const observed = days
    .map((day, index) => ({ day, value: values[index] }))
    .filter((entry): entry is { day: string; value: number } => entry.day <= asOf && finite(entry.value));
  if (observed.length === 0) return null;

  const future = days.filter((day) => day > asOf);
  // Выровнено с `future`: неполный факт дня или null.
  const partials = days
    .map((day, index) => ({ day, value: values[index] }))
    .filter((entry) => entry.day > asOf)
    .map((entry) => (options.partialAfterAsOf && finite(entry.value) && entry.value > 0 ? entry.value : null));
  const actualTotal = observed.reduce((sum, entry) => sum + entry.value, 0);
  const coveragePct = coverageForPeriod(days, values, asOf);
  if (future.length === 0) {
    return {
      value: actualTotal,
      low: actualTotal,
      high: actualTotal,
      confidencePct: Math.round(coveragePct),
      coveragePct,
      observedDays: observed.length,
      futureDays: 0,
      method: "Завершённый период: прогноз равен факту",
    };
  }

  const observedValues = observed.map((entry) => entry.value);
  const overallMean = average(observedValues);
  const weekdayValues = new Map<number, number[]>();
  for (const entry of observed) {
    const key = weekday(entry.day);
    weekdayValues.set(key, [...(weekdayValues.get(key) ?? []), entry.value]);
  }

  const recent = observedValues.slice(-Math.min(7, observedValues.length));
  const previous = observedValues.slice(-Math.min(14, observedValues.length), -recent.length);
  const recentMean = average(recent);
  const previousMean = average(previous);
  const trend = previous.length >= 3 && previousMean > 0 && recentMean >= 0
    ? clamp(recentMean / previousMean, 0.75, 1.25)
    : 1;

  const dayProjections = future.map((day) => {
    const samples = weekdayValues.get(weekday(day)) ?? [];
    const weekdayMean = samples.length
      ? (samples.reduce((total, value) => total + value, 0) + overallMean * WEEKDAY_PRIOR_DAYS)
        / (samples.length + WEEKDAY_PRIOR_DAYS)
      : overallMean;
    return weekdayMean * trend;
  });
  const projected = dayProjections.reduce((sum, value) => sum + value, 0);

  const variance = observedValues.reduce((sum, item) => sum + (item - overallMean) ** 2, 0) / observedValues.length;
  const coefficientOfVariation = Math.abs(overallMean) > 0.0001
    ? Math.min(2, Math.sqrt(variance) / Math.abs(overallMean))
    : 0.5;
  const missingShare = 1 - coveragePct / 100;
  const uncertainty = clamp(
    0.12 + 0.6 / Math.sqrt(observed.length) + coefficientOfVariation * 0.25 + missingShare * 0.5,
    0.15,
    0.75,
  );
  const method = "Факт + профиль дня недели + краткосрочный тренд; календарь акций не подключён";

  if (partials.every((value) => value == null)) {
    const projectedLow = projected * (1 - uncertainty);
    const projectedHigh = projected * (1 + uncertainty);
    return {
      value: actualTotal + projected,
      low: Math.min(actualTotal + projectedLow, actualTotal + projectedHigh),
      high: Math.max(actualTotal + projectedLow, actualTotal + projectedHigh),
      confidencePct: Math.round((1 - uncertainty) * 100),
      coveragePct,
      observedDays: observed.length,
      futureDays: future.length,
      method,
    };
  }

  // Неполный день: оценка дня — не ниже уже пришедшего факта, вилка — вокруг
  // этой оценки, и её низ тоже не ниже факта. Верх не схлопывается в факт:
  // статистика внутри дня отстаёт от воронки, день ещё добирает.
  const floorAt = (index: number, value: number) => Math.max(value, partials[index] ?? -Infinity);
  const estimates = dayProjections.map((projection, index) => floorAt(index, projection));
  const sumDays = (pick: (estimate: number, index: number) => number) =>
    estimates.reduce((sum, estimate, index) => sum + pick(estimate, index), 0);
  return {
    value: actualTotal + sumDays((estimate) => estimate),
    low: actualTotal + sumDays((estimate, index) =>
      floorAt(index, Math.min(estimate * (1 - uncertainty), estimate * (1 + uncertainty)))),
    high: actualTotal + sumDays((estimate) => Math.max(estimate * (1 - uncertainty), estimate * (1 + uncertainty))),
    confidencePct: Math.round((1 - uncertainty) * 100),
    coveragePct,
    observedDays: observed.length,
    futureDays: future.length,
    method: `${method}${PARTIAL_FLOOR_METHOD_NOTE}`,
    partialFloor: true,
  };
}

export function forecastRatioMetric(
  numerator: RnpMetricForecast | null,
  denominator: RnpMetricForecast | null,
  multiplier = 100,
): RnpMetricForecast | null {
  if (!numerator || !denominator || denominator.value <= 0) return null;
  const denominatorBounds = [denominator.low, denominator.high].filter((value) => value > 0);
  if (denominatorBounds.length === 0) return null;
  const candidates = [numerator.low, numerator.high].flatMap((top) =>
    denominatorBounds.map((bottom) => top / bottom * multiplier));
  const value = numerator.value / denominator.value * multiplier;
  // Метод — от части, которая ещё прогнозируется: реклама за сегодня есть, а
  // заказы нет — подпись «прогноз равен факту» от числителя была бы неправдой.
  // Опору на неполный день несёт любая из частей — пометка нужна и доле.
  const open = numerator.futureDays > 0 || denominator.futureDays === 0 ? numerator : denominator;
  const partialFloor = Boolean(numerator.partialFloor || denominator.partialFloor);
  const method = partialFloor && !open.partialFloor ? `${open.method}${PARTIAL_FLOOR_METHOD_NOTE}` : open.method;
  return {
    value,
    low: Math.min(...candidates),
    high: Math.max(...candidates),
    confidencePct: Math.min(numerator.confidencePct, denominator.confidencePct),
    coveragePct: Math.min(numerator.coveragePct, denominator.coveragePct),
    observedDays: Math.min(numerator.observedDays, denominator.observedDays),
    futureDays: Math.max(numerator.futureDays, denominator.futureDays),
    method: `Производная метрика: ${method}`,
    ...(partialFloor ? { partialFloor } : {}),
  };
}
