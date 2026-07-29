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
