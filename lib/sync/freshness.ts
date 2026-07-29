export type SyncFreshnessState = "ok" | "error" | "missed" | "never";

interface SyncFreshnessInput {
  status?: string | null;
  finished_at?: string | null;
}

export interface SyncFreshness {
  state: SyncFreshnessState;
  ageMinutes: number | null;
}

export function syncFreshness(
  row: SyncFreshnessInput | null | undefined,
  now = Date.now(),
  maxAgeMinutes = 90,
): SyncFreshness {
  if (!row?.finished_at) return { state: "never", ageMinutes: null };
  const finishedAt = new Date(row.finished_at).getTime();
  if (!Number.isFinite(finishedAt)) return { state: "never", ageMinutes: null };
  const ageMinutes = Math.max(0, Math.floor((now - finishedAt) / 60_000));
  if (row.status !== "ok") return { state: "error", ageMinutes };
  if (ageMinutes > maxAgeMinutes) return { state: "missed", ageMinutes };
  return { state: "ok", ageMinutes };
}
