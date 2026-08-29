/**
 * Откуда берётся рекламный расход и насколько он полон — по каждому кабинету.
 *
 * У расхода два хранилища с разными свойствами: скользящее окно
 * (`ozon_ad_cache`, «последние N дней», пересобирается раз в сутки целиком) и
 * история по дням (`ozon_ad_daily`, дозаполняется по одному дню в час, глубина
 * ограничена). Ни одно из них не годится всегда, и раньше выбор делался на весь
 * скоуп сразу: история одного кабинета «покрывала» период, и расход остальных
 * кабинетов молча становился нулём.
 *
 * Правило простое: считаем покрытие ОТДЕЛЬНО по каждому кабинету и берём
 * источник, который действительно описывает запрошенный период. Если не описывает
 * ни один — честно говорим «не собрано», а не показываем ноль как факт. Ноль и
 * отсутствие данных — разные ответы, и путать их дороже всего: нулевой расход
 * завышает прибыль в юнит-экономике.
 */

export type OzonAdSource = "daily" | "window" | "live" | "none";

export interface OzonAdCoverage {
  clientId: string;
  cabinet: string;
  /** Дней в запрошенном периоде. */
  periodDays: number;
  /** Дней, которые в принципе могут быть в истории (сегодняшний ещё идёт). */
  historyDays: number;
  /** Из них собрано. */
  coveredDays: number;
  source: OzonAdSource;
  /** Данные описывают период целиком. */
  complete: boolean;
}

export interface OzonAdSourceInput {
  periodDays: number;
  endsToday: boolean;
  /** Сколько дней периода есть в истории по дням. */
  coveredDays: number;
  /** Есть ли в истории хоть какой-то расход (маркеры пустых дней не в счёт). */
  dailyHasSpend: boolean;
  /** Окно «последние N дней» прочитано и относится к этому же периоду. */
  windowAvailable: boolean;
  /** Есть ли расход в окне. */
  windowHasSpend: boolean;
}

/**
 * Сегодняшнего дня в истории нет никогда: он ещё идёт, и отчёт по нему
 * появится только завтра. Поэтому «полная история» для периода, кончающегося
 * сегодня, — это все дни, кроме последнего.
 */
export function ozonAdHistoryDays(periodDays: number, endsToday: boolean): number {
  return Math.max(0, periodDays - (endsToday ? 1 : 0));
}

export function chooseOzonAdSource(input: OzonAdSourceInput): { source: OzonAdSource; complete: boolean } {
  const historyDays = ozonAdHistoryDays(input.periodDays, input.endsToday);

  // История покрывает период целиком — самый точный ответ: она знает разбивку
  // по дням и не зависит от длины окна.
  if (historyDays > 0 && input.coveredDays >= historyDays) {
    return { source: "daily", complete: true };
  }

  // Окно описывает ровно «последние N дней» и пересобирается целиком, поэтому
  // для периода, кончающегося сегодня, оно полнее тонкой истории.
  if (input.endsToday && input.windowAvailable && input.windowHasSpend) {
    return { source: "window", complete: true };
  }

  // Частичная история лучше молчания, но выдавать её за полный период нельзя:
  // расход занижен ровно на несобранные дни.
  if (input.coveredDays > 0 && input.dailyHasSpend) {
    return { source: "daily", complete: false };
  }

  // Пустое окно — законный ответ «расхода не было», но только если оно
  // действительно про этот период.
  if (input.endsToday && input.windowAvailable) {
    return { source: "window", complete: true };
  }

  // Собранные дни без расхода — тоже факт: реклама не крутилась.
  if (input.coveredDays > 0 && historyDays > 0 && input.coveredDays >= historyDays) {
    return { source: "daily", complete: true };
  }

  return { source: "none", complete: false };
}

/** Короткая человеческая подпись для интерфейса. */
export function describeOzonAdCoverage(coverage: OzonAdCoverage): string {
  if (coverage.source === "none") {
    return coverage.periodDays === 1 && coverage.historyDays === 0
      ? "расход за сегодня Ozon отдаёт завтра"
      : "рекламный расход за период ещё не собран";
  }
  if (coverage.complete) return "";
  return `реклама собрана за ${coverage.coveredDays} из ${coverage.historyDays} дн.`;
}
