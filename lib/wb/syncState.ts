import type { SupabaseClient } from "@supabase/supabase-js";

export interface WbSyncState<T extends Record<string, unknown> = Record<string, unknown>> {
  cursor: string | null;
  status: string;
  attempts: number;
  lastError: string | null;
  state: T;
  updatedAt: string | null;
}

async function selectWbSyncState<T extends Record<string, unknown>>(
  db: SupabaseClient,
  cabinetId: string,
  job: string,
): Promise<{ state: WbSyncState<T> | null; error: string | null }> {
  const { data, error } = await db
    .from("wb_sync_state")
    .select("cursor, status, attempts, last_error, state, updated_at")
    .eq("cabinet_id", cabinetId)
    .eq("job", job)
    .maybeSingle();
  if (error) return { state: null, error: error.message };
  if (!data) return { state: null, error: null };
  return {
    state: {
      cursor: data.cursor as string | null,
      status: String(data.status ?? "pending"),
      attempts: Number(data.attempts ?? 0),
      lastError: data.last_error as string | null,
      state: (data.state ?? {}) as T,
      updatedAt: data.updated_at as string | null,
    },
    error: null,
  };
}

export async function readWbSyncState<T extends Record<string, unknown>>(
  db: SupabaseClient,
  cabinetId: string,
  job: string,
): Promise<WbSyncState<T> | null> {
  return (await selectWbSyncState<T>(db, cabinetId, job)).state;
}

/**
 * То же чтение, но ошибка базы бросается, а не выдаётся за «состояния нет».
 * Курсор, который перезапишут по ошибке чтения, — это потерянные дни и забытая
 * пауза: тот, кто ПИШЕТ состояние обратно, обязан отличать «строки нет» от «база не ответила».
 */
export async function readWbSyncStateOrThrow<T extends Record<string, unknown>>(
  db: SupabaseClient,
  cabinetId: string,
  job: string,
): Promise<WbSyncState<T> | null> {
  const { state, error } = await selectWbSyncState<T>(db, cabinetId, job);
  if (error) throw new Error(`wb_sync_state: ${error}`);
  return state;
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

  // Ошибка чтения — не «состояния нет»: иначе запись ниже затёрла бы настоящий курсор пустым {}.
  // Не смогли прочитать — аренду не берём, следующий прогон попробует снова.
  let current: WbSyncState<Record<string, unknown>> | null;
  try {
    current = await readWbSyncStateOrThrow(db, cabinetId, job);
  } catch {
    return false;
  }
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
