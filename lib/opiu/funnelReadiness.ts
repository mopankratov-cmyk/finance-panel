export interface FunnelSyncStateRow {
  cabinet_id: unknown;
  job: unknown;
  status: unknown;
  attempts: unknown;
  last_error: unknown;
  state: unknown;
  updated_at: unknown;
}

const FUNNEL_JOB = "funnel";
const MAX_FUNNEL_AGE_MS = 48 * 60 * 60 * 1000;

function validFreshTimestamp(value: unknown, nowMs: number): boolean {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    return false;
  }
  const timestampMs = Date.parse(value);
  return Number.isFinite(timestampMs)
    && timestampMs <= nowMs
    && nowMs - timestampMs <= MAX_FUNNEL_AGE_MS;
}

export function isFunnelSyncReady(
  row: FunnelSyncStateRow | null | undefined,
  expectedCabinetId: string,
  now: Date,
): boolean {
  if (!row || !Number.isFinite(now.getTime())) return false;
  if (row.cabinet_id !== expectedCabinetId || row.job !== FUNNEL_JOB) return false;
  if (row.status !== "caught_up" || row.attempts !== 0 || row.last_error !== null) {
    return false;
  }
  if (!row.state || typeof row.state !== "object" || Array.isArray(row.state)) {
    return false;
  }

  const state = row.state as Record<string, unknown>;
  if (state.coveragePct !== 100 || state.nextBatch !== 0) return false;

  const nowMs = now.getTime();
  return validFreshTimestamp(row.updated_at, nowMs)
    && validFreshTimestamp(state.lastSyncedAt, nowMs);
}

/**
 * isFunnelSyncReady требует, чтобы ВЕСЬ job был "caught_up" (100% покрытие,
 * nextBatch=0) — то есть пока job на середине очередного прохода (обычное
 * рабочее состояние, не ошибка), ЛЮБАЯ дата, включая давно завершённые и
 * уже полностью засинканные недели, теряет доступ к данным Воронки и
 * откатывается на менее точный wb_orders. Из-за этого "Заказы" на бою
 * мигали между двумя разными числами для одной и той же прошедшей недели
 * в зависимости от того, успел ли job закончить текущий проход к моменту
 * запроса — а сам запрос обычно охватывает весь месяц целиком, а не одну
 * неделю, так что задевало вообще все недели разом.
 *
 * Эта функция вместо бинарного да/нет возвращает "дату отсечки доверия":
 * данные СТРОГО РАНЬШЕ этой даты можно использовать даже если job сейчас
 * на середине прохода — они уже засинканы предыдущими завершёнными
 * проходами (state.lastPeriod.begin — начало периода, который job
 * обрабатывает прямо сейчас). Данные на/после этой даты — под вопросом,
 * их лучше не трогать. `cutoff: null` означает "доверяем всему диапазону"
 * (job полностью caught_up). Реальный сбой (ошибка/ретраи/устаревание) —
 * `ready: false`, не доверяем ничему, как и раньше.
 */
export interface FunnelTrust {
  ready: boolean;
  /** null = доверяем всему запрошенному диапазону; иначе — только датам < cutoff. */
  cutoff: string | null;
}

export function funnelTrustCutoff(
  row: FunnelSyncStateRow | null | undefined,
  expectedCabinetId: string,
  now: Date,
): FunnelTrust {
  const notReady: FunnelTrust = { ready: false, cutoff: null };
  if (!row || !Number.isFinite(now.getTime())) return notReady;
  if (row.cabinet_id !== expectedCabinetId || row.job !== FUNNEL_JOB) return notReady;
  if (row.attempts !== 0 || row.last_error !== null) return notReady;
  // "running" — джоб claimWbSyncJob() держит лок и активно выполняет текущий
  // проход (lib/wb/syncState.ts). Это рутинное состояние на каждый запуск
  // cron'а, а не сбой — state.lastPeriod (см. ниже) при переходе в "running"
  // сохраняется из предыдущего прохода как есть, так что cutoff по нему
  // остаётся корректным. Без этой строки ЛЮБОЙ запрос, попавший на момент
  // активного синка, полностью терял доступ к Воронке и откатывался на
  // wb_orders — отсюда и "гуляющие" числа Заказов между одинаковыми
  // повторными открытиями отчёта.
  if (row.status !== "caught_up" && row.status !== "pending" && row.status !== "running") {
    return notReady;
  }
  if (!row.state || typeof row.state !== "object" || Array.isArray(row.state)) {
    return notReady;
  }

  const state = row.state as Record<string, unknown>;
  const nowMs = now.getTime();
  if (!validFreshTimestamp(row.updated_at, nowMs) || !validFreshTimestamp(state.lastSyncedAt, nowMs)) {
    return notReady;
  }

  if (row.status === "caught_up" && state.coveragePct === 100 && state.nextBatch === 0) {
    return { ready: true, cutoff: null };
  }

  const lastPeriod = state.lastPeriod;
  if (!lastPeriod || typeof lastPeriod !== "object" || Array.isArray(lastPeriod)) {
    return notReady;
  }
  const periodBegin = (lastPeriod as Record<string, unknown>).begin;
  if (typeof periodBegin !== "string" || periodBegin.trim() !== periodBegin || periodBegin.length === 0) {
    return notReady;
  }
  return { ready: true, cutoff: periodBegin };
}

export function funnelReadinessFingerprint(row: FunnelSyncStateRow): string | null {
  if (!row.state || typeof row.state !== "object" || Array.isArray(row.state)) {
    return null;
  }
  const state = row.state as Record<string, unknown>;
  return JSON.stringify([
    row.cabinet_id,
    row.job,
    row.status,
    row.attempts,
    row.last_error,
    state.coveragePct,
    state.nextBatch,
    state.lastSyncedAt,
    row.updated_at,
  ]);
}
