/**
 * Курсор бэкфилла accrual/by-day — чистые функции, без I/O.
 *
 * Раньше курсор держал булев флаг `backfillComplete`: после того как он
 * становился true, синк каждый прогон брал фиксированную "вчера" дату и
 * никогда больше не возвращался назад. Если крон не отработал один или
 * несколько прогонов подряд (деплой, сбой сети), пропущенные дни терялись
 * навсегда — они не были ни во "вчера", ни в диапазоне бэкфилла, который уже
 * считался закрытым.
 *
 * Вместо флага курсор хранит только `pendingDate` — дату, которую нужно
 * (пере)синхронизировать — и всегда двигает её на +1 день за раз. Он никогда
 * не прыгает к фиксированной точке: если "вчера" ушло вперёд, курсор просто
 * продолжает докатываться до него день за днём на следующих прогонах.
 */
export interface OzonAccrualCursorState extends Record<string, unknown> {
  backfillFloor: string;
  pendingDate: string;
  pendingAttempts: number;
}

/** Сколько подряд НЕ-рейтлимитных неудач на одной дате терпим, прежде чем сдаться и пойти дальше. */
export const MAX_DATE_ATTEMPTS = 5;

function addDaysIso(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export function initAccrualCursorState(backfillFloor: string): OzonAccrualCursorState {
  return { backfillFloor, pendingDate: backfillFloor, pendingAttempts: 0 };
}

/** Дата, которую реально стоит запросить в этом прогоне — не позже вчера (сегодняшний день ещё не закрыт у Ozon). */
export function targetSyncDate(state: OzonAccrualCursorState, yesterday: string): string {
  return state.pendingDate > yesterday ? yesterday : state.pendingDate;
}

export function advanceAfterSuccess(
  state: OzonAccrualCursorState,
  syncedDate: string,
): OzonAccrualCursorState {
  return { ...state, pendingDate: addDaysIso(syncedDate, 1), pendingAttempts: 0 };
}

/**
 * Настоящая (не 429) неудача на дате. После MAX_DATE_ATTEMPTS подряд
 * сдаёмся и идём дальше — явный, залогированный пропуск даты лучше, чем
 * зависший навечно бэкфилл.
 */
export function advanceAfterFailure(
  state: OzonAccrualCursorState,
  failedDate: string,
): { state: OzonAccrualCursorState; gaveUp: boolean } {
  const attempts = state.pendingAttempts + 1;
  if (attempts >= MAX_DATE_ATTEMPTS) {
    return {
      state: { ...state, pendingDate: addDaysIso(failedDate, 1), pendingAttempts: 0 },
      gaveUp: true,
    };
  }
  return { state: { ...state, pendingAttempts: attempts }, gaveUp: false };
}
