export const SYNC_WATCHDOG_SLA_MINUTES = {
  sales: 130,
  stocks: 130,
  feedbacks: 130,
  funnel: 130,
  adverts: 130,
  orders: 130,
  commissions: 130,
  "token-health": 36 * 60,
} as const;

export type SyncWatchdogJob = keyof typeof SYNC_WATCHDOG_SLA_MINUTES;

export interface SyncWatchdogLogRow {
  job: string;
  status: string;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export interface SyncWatchdogJobStatus {
  job: SyncWatchdogJob;
  status: string | null;
  lastRunAt: string | null;
  ageMinutes: number | null;
  slaMinutes: number;
  error: string | null;
}

export interface SyncWatchdogIssue {
  job: SyncWatchdogJob;
  kind: "missing" | "failed" | "stale" | "invalid_timestamp";
  message: string;
}

function rowTimestamp(row: SyncWatchdogLogRow): number {
  const raw = row.finished_at || row.started_at;
  if (!raw) return Number.NEGATIVE_INFINITY;
  const value = new Date(raw).getTime();
  return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

export function syncWatchdogHealth(rows: SyncWatchdogLogRow[], now = Date.now()) {
  const latest = new Map<SyncWatchdogJob, SyncWatchdogLogRow>();
  for (const row of rows) {
    if (!(row.job in SYNC_WATCHDOG_SLA_MINUTES)) continue;
    const job = row.job as SyncWatchdogJob;
    const previous = latest.get(job);
    if (!previous || rowTimestamp(row) > rowTimestamp(previous)) latest.set(job, row);
  }

  const jobs: SyncWatchdogJobStatus[] = [];
  const issues: SyncWatchdogIssue[] = [];

  for (const [job, slaMinutes] of Object.entries(SYNC_WATCHDOG_SLA_MINUTES) as Array<[SyncWatchdogJob, number]>) {
    const row = latest.get(job);
    if (!row) {
      jobs.push({ job, status: null, lastRunAt: null, ageMinutes: null, slaMinutes, error: null });
      issues.push({ job, kind: "missing", message: `${job}: нет ни одного результата синхронизации` });
      continue;
    }

    const lastRunAt = row.finished_at || row.started_at;
    const timestamp = lastRunAt ? new Date(lastRunAt).getTime() : Number.NaN;
    if (!Number.isFinite(timestamp)) {
      jobs.push({ job, status: row.status, lastRunAt, ageMinutes: null, slaMinutes, error: row.error });
      issues.push({ job, kind: "invalid_timestamp", message: `${job}: некорректное время последнего запуска` });
      continue;
    }

    const ageMinutes = Math.max(0, Math.round((now - timestamp) / 60_000));
    jobs.push({ job, status: row.status, lastRunAt, ageMinutes, slaMinutes, error: row.error });
    if (row.status !== "ok" || row.error) {
      issues.push({
        job,
        kind: "failed",
        message: `${job}: последний запуск завершился со статусом ${row.status || "unknown"}${row.error ? ` — ${row.error}` : ""}`,
      });
    } else if (ageMinutes > slaMinutes) {
      issues.push({ job, kind: "stale", message: `${job}: нет успешного обновления ${ageMinutes} мин (SLA ${slaMinutes} мин)` });
    }
  }

  return { ok: issues.length === 0, jobs, issues };
}
