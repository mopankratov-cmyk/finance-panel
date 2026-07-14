import type { SupabaseClient } from "@supabase/supabase-js";

export interface WbSyncState<T extends Record<string, unknown> = Record<string, unknown>> {
  cursor: string | null;
  status: string;
  attempts: number;
  lastError: string | null;
  state: T;
  updatedAt: string | null;
}

export async function readWbSyncState<T extends Record<string, unknown>>(
  db: SupabaseClient,
  cabinetId: string,
  job: string,
): Promise<WbSyncState<T> | null> {
  const { data, error } = await db
    .from("wb_sync_state")
    .select("cursor, status, attempts, last_error, state, updated_at")
    .eq("cabinet_id", cabinetId)
    .eq("job", job)
    .maybeSingle();
  if (error || !data) return null;
  return {
    cursor: data.cursor as string | null,
    status: String(data.status ?? "pending"),
    attempts: Number(data.attempts ?? 0),
    lastError: data.last_error as string | null,
    state: (data.state ?? {}) as T,
    updatedAt: data.updated_at as string | null,
  };
}

export async function writeWbSyncState<T extends Record<string, unknown>>(
  db: SupabaseClient,
  cabinetId: string,
  job: string,
  values: Partial<WbSyncState<T>>,
): Promise<string | null> {
  const row = {
    cabinet_id: cabinetId,
    job,
    cursor: values.cursor ?? null,
    status: values.status ?? "pending",
    attempts: values.attempts ?? 0,
    last_error: values.lastError ?? null,
    state: values.state ?? {},
    updated_at: new Date().toISOString(),
  };
  const { error } = await db.from("wb_sync_state").upsert(row, { onConflict: "cabinet_id,job" });
  return error?.message ?? null;
}

/** Atomic in migrated databases; conservative fallback keeps old deployments working. */
export async function claimWbSyncJob(
  db: SupabaseClient,
  cabinetId: string,
  job: string,
  staleAfterSeconds = 900,
): Promise<boolean> {
  const claim = await db.rpc("claim_wb_sync_job", {
    p_cabinet_id: cabinetId,
    p_job: job,
    p_stale_after_seconds: staleAfterSeconds,
  });
  if (!claim.error) return claim.data === true;

  const current = await readWbSyncState(db, cabinetId, job);
  const runningFresh = current?.status === "running"
    && current.updatedAt
    && Date.now() - new Date(current.updatedAt).getTime() < staleAfterSeconds * 1_000;
  if (runningFresh) return false;
  return (await writeWbSyncState(db, cabinetId, job, {
    cursor: current?.cursor ?? null,
    status: "running",
    attempts: current?.attempts ?? 0,
    lastError: null,
    state: current?.state ?? {},
  })) === null;
}
