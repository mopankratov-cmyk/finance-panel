export interface SyncLogLike {
  job: string;
  status: string;
  finished_at: string | null;
  error?: string | null;
}

export const WB_CACHE_REQUIRED_JOBS = [
  "orders",
  "sales",
  "stocks",
  "adverts",
  "advert-stats",
  "funnel",
  "feedbacks",
] as const;

export function wbCacheReadiness(
  rows: SyncLogLike[],
  now = Date.now(),
  maxAgeMinutes = 90,
): { ready: boolean; missing: string[]; failed: string[]; stale: string[] } {
  const latest = new Map<string, SyncLogLike>();
  for (const row of rows) if (!latest.has(row.job)) latest.set(row.job, row);
  const missing: string[] = [];
  const failed: string[] = [];
  const stale: string[] = [];
  for (const job of WB_CACHE_REQUIRED_JOBS) {
    const row = latest.get(job);
    if (!row?.finished_at) {
      missing.push(job);
      continue;
    }
    if (row.status !== "ok" || row.error) failed.push(job);
    if (now - new Date(row.finished_at).getTime() > maxAgeMinutes * 60_000) stale.push(job);
  }
  return { ready: missing.length === 0 && failed.length === 0 && stale.length === 0, missing, failed, stale };
}

export interface SyncProgressLike {
  cabinet_id: string;
  job: string;
  status: string;
  last_error?: string | null;
}

export interface WbCacheCabinetLike {
  id: string;
  scoped: boolean;
}

export const WB_CACHE_PROGRESS_JOBS = ["advert-stats", "funnel", "feedbacks"] as const;

export function wbCacheProgressReadiness(
  rows: SyncProgressLike[],
  cabinets: WbCacheCabinetLike[],
): { ready: boolean; missing: string[]; failed: string[]; incomplete: string[] } {
  const byKey = new Map(rows.map((row) => [`${row.cabinet_id}:${row.job}`, row]));
  const missing: string[] = [];
  const failed: string[] = [];
  const incomplete: string[] = [];
  for (const cabinet of cabinets) {
    const jobs = [...WB_CACHE_PROGRESS_JOBS, ...(cabinet.scoped ? ["product-scope" as const] : [])];
    for (const job of jobs) {
      const key = `${cabinet.id}:${job}`;
      const row = byKey.get(key);
      if (!row) missing.push(key);
      else if (row.status === "error" || row.last_error) failed.push(key);
      else if (row.status !== "caught_up" && row.status !== "complete") incomplete.push(key);
    }
  }
  return {
    ready: missing.length === 0 && failed.length === 0 && incomplete.length === 0,
    missing,
    failed,
    incomplete,
  };
}
